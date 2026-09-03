package com.dsharnessmobile.shell

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.security.SecureRandom
import java.util.concurrent.Semaphore

/** Loopback-only JSON bridge used by the usr/bin/pkg wrapper. */
class TermuxPackageService private constructor(
  private val context: Context,
  private val prefix: java.io.File,
) {
  data class Endpoint(val port: Int, val token: String) {
    val url: String get() = "http://127.0.0.1:$port"
  }

  private val token = randomToken()
  private val endpointFile = File(context.filesDir, ".dsh-pkg-endpoint")
  private val manager = TermuxPackageManager(prefix)
  private val workers = Executors.newCachedThreadPool()
  private val operations = ConcurrentHashMap<String, Operation>()
  private data class Operation(
    val id: String,
    val command: String,
    @Volatile var state: String = "running",
    @Volatile var output: String = "",
    @Volatile var code: Int? = null
  )
  private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
  private val activeRequests = Semaphore(4)
  private val thread = Thread {
    while (!server.isClosed) {
      try {
        val client = server.accept()
        workers.submit {
          if (activeRequests.tryAcquire()) {
            try { handle(client) } finally { activeRequests.release() }
          } else {
            try { client.close() } catch (_: Throwable) {}
          }
        }
      } catch (_: Throwable) { break }
    }
  }.apply { name = "dsh-pkg-service"; isDaemon = true }

  init { thread.start() }

  fun endpoint(): Endpoint {
    val result = Endpoint(server.localPort, token)
    try {
      val temp = File(context.filesDir, ".dsh-pkg-endpoint.tmp")
      temp.writeText("${result.url}\n${result.token}\n")
      temp.setReadable(false, false)
      temp.setReadable(true, true)
      try {
        Files.move(
          temp.toPath(), endpointFile.toPath(),
          StandardCopyOption.REPLACE_EXISTING,
          StandardCopyOption.ATOMIC_MOVE,
        )
      } catch (_: Throwable) {
        if (!temp.renameTo(endpointFile)) temp.delete()
      }
    } catch (t: Throwable) {
      Log.w(TAG, "cannot persist package endpoint: " + (t.message ?: t.javaClass.simpleName))
    }
    return result
  }

  private fun handle(socket: Socket) {
    socket.use { s ->
      s.soTimeout = 190_000
      val input = BufferedInputStream(s.getInputStream())
      val requestLine = readHttpLine(input) ?: return
      val headers = mutableMapOf<String, String>()
      while (true) {
        val line = readHttpLine(input) ?: return
        if (line.isEmpty()) break
        val p = line.indexOf(':')
        if (p > 0) headers[line.substring(0, p).trim().lowercase()] = line.substring(p + 1).trim()
      }
      val length = headers["content-length"]?.toIntOrNull() ?: 0
      if (length <= 0 || length > MAX_BODY_BYTES) return
      val body = ByteArray(length)
      var offset = 0
      while (offset < length) {
        val n = input.read(body, offset, length - offset)
        if (n < 0) return
        offset += n
      }
      val response = try {
        if (!requestLine.startsWith("POST /pkg ") && !requestLine.startsWith("POST /pkg-start ") && !requestLine.startsWith("POST /pkg-status ")) error("bad request")
        val request = JSONObject(String(body, Charsets.UTF_8))
        if (request.optString("token") != token) error("unauthorized")
        
        if (requestLine.startsWith("POST /pkg-start ")) {
          val jsonArgs = request.optJSONArray("args") ?: JSONArray()
          val args = buildList { for (i in 0 until jsonArgs.length()) add(jsonArgs.getString(i)) }
          val opId = UUID.randomUUID().toString()
          val op = Operation(opId, args.joinToString(" "))
          operations[opId] = op
          workers.submit {
            try {
              val result = manager.execute(args)
              op.output = result.stdout + "\n" + result.stderr
              op.code = result.code
              op.state = "completed"
            } catch (t: Throwable) {
              op.output = (op.output + "\n" + (t.message ?: "failed")).trim()
              op.code = 1
              op.state = "completed"
            }
          }
          JSONObject().put("jobId", opId).toString()
        } else if (requestLine.startsWith("POST /pkg-status ")) {
          val opId = request.optString("jobId")
          val op = operations[opId]
          if (op == null) JSONObject().put("state", "not_found").put("output", "").put("code", -1).toString()
          else {
            val json = JSONObject().put("state", op.state).put("output", op.output)
            if (op.state == "completed") {
              json.put("code", op.code ?: 1)
            }
            json.toString()
          }
        } else {
          val jsonArgs = request.optJSONArray("args") ?: JSONArray()
          val args = buildList { for (i in 0 until jsonArgs.length()) add(jsonArgs.getString(i)) }
          val result = manager.execute(args)
          JSONObject().put("stdout", result.stdout).put("stderr", result.stderr).put("code", result.code).toString()
        }
      } catch (t: Throwable) {
        JSONObject().put("stdout", "").put("stderr", t.message ?: "package service error").put("code", 1).toString()
      }
      val bytes = response.toByteArray(Charsets.UTF_8)
      val output = s.getOutputStream()
      output.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
      output.write(bytes)
      output.flush()
    }
  }

  private fun readHttpLine(input: BufferedInputStream): String? {
    val bytes = ByteArrayOutputStream()
    while (bytes.size() <= MAX_HEADER_BYTES) {
      val value = input.read()
      if (value < 0) return null
      if (value == '\n'.code) {
        val raw = bytes.toByteArray()
        val end = if (raw.lastOrNull() == '\r'.code.toByte()) raw.size - 1 else raw.size
        return String(raw, 0, end, Charsets.US_ASCII)
      }
      bytes.write(value)
    }
    return null
  }

  fun close() {
    try { server.close() } catch (_: Throwable) {}
    workers.shutdownNow()
    try { endpointFile.delete() } catch (_: Throwable) {}
  }

  companion object {
    private const val TAG = "dsh-pkg-service"
    private const val MAX_BODY_BYTES = 64 * 1024
    private const val MAX_HEADER_BYTES = 8 * 1024
    @Volatile private var active: TermuxPackageService? = null

    @Synchronized
    fun ensure(context: Context, prefix: java.io.File): Endpoint {
      val current = active
      if (current == null || current.server.isClosed || current.prefix.absolutePath != prefix.absolutePath) {
        current?.close()
        active = TermuxPackageService(context.applicationContext, prefix)
      }
      return active!!.endpoint()
    }

    fun stop() {
      synchronized(this) { active?.close(); active = null }
    }

    private fun randomToken(): String {
      val bytes = ByteArray(24)
      SecureRandom().nextBytes(bytes)
      return bytes.joinToString("") { "%02x".format(it) }
    }
  }
}
