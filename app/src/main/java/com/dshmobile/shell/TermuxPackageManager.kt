package com.dsharnessmobile.shell

import android.os.Build
import org.apache.commons.compress.archivers.ar.ArArchiveInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.concurrent.locks.ReentrantLock
import java.util.zip.GZIPInputStream
import kotlin.concurrent.withLock

/**
 * Small Android-native Termux package installer.
 *
 * It intentionally implements only the package lifecycle needed by the mobile
 * runtime: repository index, dependency resolution, .deb extraction, status
 * tracking, search and removal. Native Python extensions must come from the
 * Termux repository, never from a desktop manylinux wheel.
 */
class TermuxPackageManager(private val prefix: File) {

  data class Result(val stdout: String = "", val stderr: String = "", val code: Int = 0)

  private data class PackageEntry(
    val name: String,
    val version: String,
    val architecture: String,
    val depends: String,
    val filename: String,
    val sha256: String,
    val description: String,
  )

  private data class Installed(val name: String, val version: String, val status: String)

  private data class ExtractedFiles(
    val paths: List<String>,
    val preexisting: List<String>,
  )

  private val lock = ReentrantLock()
  private val listsDir = File(prefix, "var/lib/apt/lists")
  private val cacheDir = File(prefix, "var/cache/apt/archives")
  private val statusDir = File(prefix, "var/lib/dpkg")
  // Keep our transaction state separate: never rewrite the snapshot's native dpkg database.
  private val managedDir = File(prefix, "var/lib/dsh-mobile-pkg")
  private val managedInfoDir = File(managedDir, "info")
  private val managedStatusFile = File(managedDir, "status")
  private val indexFile = File(listsDir, "dsh-packages.index")
  private val lockFile = File(managedDir, "lock")
  private val mirrors = listOf(
    "https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main",
    "https://mirrors.ustc.edu.cn/termux/apt/termux-main",
    "https://packages-cf.termux.dev/apt/termux-main",
    "https://packages.termux.dev/apt/termux-main",
  )
  private val arch = when (Build.SUPPORTED_ABIS.firstOrNull()) {
    "arm64-v8a" -> "aarch64"
    "armeabi-v7a" -> "arm"
    "x86_64" -> "x86_64"
    "x86" -> "i686"
    else -> "aarch64"
  }
  private var selectedMirror: String? = null

  fun execute(args: List<String>): Result = lock.withLock {
    lockFile.parentFile?.mkdirs()
    return@withLock try {
      FileChannel.open(lockFile.toPath(), StandardOpenOption.CREATE, StandardOpenOption.WRITE).use { channel ->
        channel.lock().use { executeUnlocked(args) }
      }
    } catch (t: Throwable) {
      LogCollector.log("dsh-pkg", "command failed: ${t.message}")
      Result(stderr = "E: ${t.message ?: t.javaClass.simpleName}\n", code = 1)
    }
  }

  private fun executeUnlocked(args: List<String>): Result {
    if (args.isEmpty()) return Result(stderr = "Usage: pkg <command> [args]\n", code = 1)
    val command = args.first()
    val values = args.drop(1).filterNot { it == "-y" || it == "--yes" || it == "-q" || it == "--quiet" }
    return when (command) {
      "update" -> update()
      "install" -> install(values)
      "reinstall" -> reinstall(values)
      "remove", "uninstall" -> remove(values)
      "search" -> search(values)
      "show" -> show(values)
      "list-installed" -> listInstalled()
      "list-all" -> listAll()
      "files" -> files(values)
      "clean", "autoclean" -> clean()
      else -> Result(stderr = "Unknown pkg command: $command\n", code = 1)
    }
  }

  private fun update(): Result {
    val data = downloadIndex()
    listsDir.mkdirs()
    val plain = GZIPInputStream(data.inputStream().buffered()).use { it.readBytes() }
    val entries = parseIndex(plain)
    if (entries.isEmpty()) return Result(stderr = "E: repository index contained no packages\n", code = 1)
    indexFile.writeBytes(plain)
    return Result(stdout = "Updated ${entries.size} packages for $arch.\n")
  }

  private fun install(names: List<String>): Result {
    if (names.isEmpty()) return Result(stderr = "Usage: pkg install <package> [package...]\n", code = 1)
    val index = loadIndexOrUpdate()
    // Treat the snapshot's already-installed packages as read-only providers.
    // Only packages tracked under dsh-mobile-pkg are ever modified or removed.
    val installed = (readInstalled() + readBaseInstalled()).associateBy { it.name }.toMutableMap()
    val order = linkedSetOf<String>()
    names.forEach { resolve(it, index, installed, order, mutableSetOf()) }
    val out = StringBuilder()
    for (name in order) {
      val entry = index[name] ?: continue
      if (installed[name]?.status?.startsWith("install ok") == true) {
        if (name in names) out.append("${entry.name} is already installed.\n")
        continue
      }
      out.append("Downloading ${entry.name} (${entry.version})...\n")
      val deb = downloadDeb(entry)
      out.append("Extracting ${entry.name}...\n")
      val extracted = extractDeb(deb)
      register(entry, extracted)
      deb.delete()
      installed[name] = Installed(entry.name, entry.version, "install ok installed")
      out.append("Installed ${entry.name}.\n")
    }
    return Result(stdout = out.toString())
  }

  private fun reinstall(names: List<String>): Result {
    if (names.isEmpty()) return Result(stderr = "Usage: pkg reinstall <package> [package...]\n", code = 1)
    removeUnlocked(names)
    return install(names)
  }

  private fun remove(names: List<String>): Result {
    if (names.isEmpty()) return Result(stderr = "Usage: pkg remove <package> [package...]\n", code = 1)
    return removeUnlocked(names)
  }

  private fun removeUnlocked(names: List<String>): Result {
    val installed = readInstalled().associateBy { it.name }.toMutableMap()
    val out = StringBuilder()
    val err = StringBuilder()
    names.forEach { raw ->
      val name = normalizeName(raw)
      if (installed[name] == null) {
        err.append("${name} is not installed.\n")
        return@forEach
      }
      val list = File(managedInfoDir, "$name.list")
      if (list.isFile) {
        list.readLines().forEach { rawPath ->
          if (rawPath.startsWith("P ")) return@forEach
          val path = safePrefixPath(rawPath)
          if (path != null && !managedOwns(rawPath, excluding = name)) path.delete()
        }
      }
      list.delete()
      installed.remove(name)
      out.append("Removed $name.\n")
    }
    writeStatus(installed.values.toList())
    return Result(out.toString(), err.toString(), if (err.isNotEmpty()) 1 else 0)
  }

  private fun search(words: List<String>): Result {
    if (words.isEmpty()) return Result(stderr = "Usage: pkg search <keyword>\n", code = 1)
    val q = words.joinToString(" ").lowercase()
    val matches = loadIndexOrUpdate().values.filter {
      it.name.lowercase().contains(q) || it.description.lowercase().contains(q)
    }
    if (matches.isEmpty()) return Result(stdout = "No results found for $q.\n", code = 1)
    return Result(stdout = matches.sortedBy { it.name }.joinToString("\n") {
      "${it.name}/$arch ${it.version} - ${it.description.lineSequence().firstOrNull() ?: ""}"
    } + "\n")
  }

  private fun show(values: List<String>): Result {
    if (values.isEmpty()) return Result(stderr = "Usage: pkg show <package>\n", code = 1)
    val name = normalizeName(values.first())
    val entry = loadIndexOrUpdate()[name]
      ?: return Result(stderr = "Package $name not found.\n", code = 1)
    return Result(stdout = "Package: ${entry.name}\nVersion: ${entry.version}\nArchitecture: $arch\nDepends: ${entry.depends}\nDescription: ${entry.description}\n")
  }

  private fun listInstalled(): Result {
    val packages = (readBaseInstalled() + readInstalled()).distinctBy { it.name }.sortedBy { it.name }
    if (packages.isEmpty()) return Result(stdout = "No packages installed.\n")
    return Result(stdout = packages.joinToString("\n") { "${it.name} ${it.version}" } + "\n")
  }

  private fun listAll(): Result = Result(stdout = loadIndexOrUpdate().values.sortedBy { it.name }
    .joinToString("\n") { "${it.name}/$arch ${it.version} - ${it.description.lineSequence().firstOrNull() ?: ""}" } + "\n")

  private fun files(values: List<String>): Result {
    if (values.isEmpty()) return Result(stderr = "Usage: pkg files <package>\n", code = 1)
    val path = File(managedInfoDir, "${normalizeName(values.first())}.list")
    if (!path.isFile) return Result(stderr = "Package ${values.first()} has no file list.\n", code = 1)
    return Result(stdout = path.readText())
  }

  private fun clean(): Result {
    val count = cacheDir.listFiles()?.count { it.extension == "deb" } ?: 0
    cacheDir.listFiles()?.filter { it.extension == "deb" }?.forEach { it.delete() }
    return Result(stdout = "Cleaned $count cached packages.\n")
  }

  private fun resolve(
    rawName: String,
    index: Map<String, PackageEntry>,
    installed: Map<String, Installed>,
    order: LinkedHashSet<String>,
    visiting: MutableSet<String>,
  ) {
    val name = normalizeName(rawName)
    if (name.isEmpty() || name in order) return
    if (!visiting.add(name)) throw IllegalArgumentException("dependency cycle detected at $name")
    val entry = index[name] ?: throw IllegalArgumentException("Package $name not found in repository")
    parseDependencyGroups(entry.depends).forEach { alternatives ->
      val candidate = alternatives.firstOrNull { installed[it]?.status?.startsWith("install ok") == true }
        ?: alternatives.firstOrNull { index.containsKey(it) }
        ?: throw IllegalArgumentException("dependency not found: ${alternatives.joinToString(" | ")}")
      resolve(candidate, index, installed, order, visiting)
    }
    visiting.remove(name)
    order += name
  }

  private fun parseDependencyGroups(raw: String): List<List<String>> = raw.split(',').map { part ->
    part.split('|').mapNotNull { alternative ->
      normalizeName(alternative.substringBefore('(')).takeIf { it.isNotEmpty() }
    }
  }.filter { it.isNotEmpty() }

  private fun normalizeName(raw: String): String = raw.trim().substringBefore(':').lowercase()

  private fun loadIndexOrUpdate(): Map<String, PackageEntry> {
    if (!indexFile.isFile) update()
    val parsed = parseIndex(indexFile.readBytes())
    if (parsed.isEmpty()) throw IllegalStateException("cached package index is empty")
    return parsed
  }

  private fun downloadIndex(): ByteArray {
    var last: Throwable? = null
    for (mirror in mirrors) {
      try {
        val url = "$mirror/dists/stable/main/binary-$arch/Packages.gz"
        val data = httpGet(url)
        selectedMirror = mirror
        return data
      } catch (t: Throwable) {
        last = t
      }
    }
    throw IllegalStateException("download Packages.gz failed: ${last?.message}")
  }

  private fun downloadDeb(entry: PackageEntry): File {
    val filename = entry.filename.trim().removePrefix("./").removePrefix("/")
    if (filename.isEmpty() || filename.contains("..") || filename.contains('\\') || filename.startsWith("http", true)) {
      throw SecurityException("unsafe package filename")
    }
    cacheDir.mkdirs()
    val target = File(cacheDir, File(filename).name)
    if (!target.isFile || (entry.sha256.isNotBlank() && sha256(target) != entry.sha256)) {
      val mirror = selectedMirror ?: mirrors.first()
      httpDownloadToFile("$mirror/$filename", target)
    }
    if (entry.sha256.isNotBlank() && sha256(target) != entry.sha256) {
      target.delete()
      throw SecurityException("SHA-256 mismatch for ${entry.name}")
    }
    return target
  }

  private fun extractDeb(deb: File): ExtractedFiles {
    val input = ArArchiveInputStream(BufferedInputStream(FileInputStream(deb)))
    input.use { ar ->
      var entry = ar.getNextArEntry()
      while (entry != null) {
        val name = entry.name.trim().removeSuffix("/")
        if (name == "data.tar.xz") {
          return extractTar(XZCompressorInputStream(BufferedInputStream(ar)))
        }
        entry = ar.getNextArEntry()
      }
      throw IllegalArgumentException("data.tar.xz missing from ${deb.name}")
    }
  }

  private fun extractTar(input: InputStream): ExtractedFiles {
    val tar = TarArchiveInputStream(BufferedInputStream(input))
    val installed = mutableListOf<String>()
    val preexisting = mutableListOf<String>()
    var totalBytes = 0L
    var entryCount = 0
    tar.use { stream ->
      var entry: TarArchiveEntry? = stream.nextTarEntry
      while (entry != null) {
        entryCount++
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw SecurityException("package contains too many entries")
        val current = entry!!
        val raw = current.name.removePrefix("./").removePrefix("data/data/com.termux/files/usr/")
        val relative = safeRelative(raw) ?: throw SecurityException("unsafe archive path: ${current.name}")
        if (relative.isNotEmpty()) {
          ensureSafeParent(relative)
          val target = File(prefix, relative)
          val existingSymlink = Files.isSymbolicLink(target.toPath())
          val wasPreexisting = target.exists() && !existingSymlink
          if (wasPreexisting || existingSymlink) preexisting += "/$relative"
          if (existingSymlink) {
            if (!isSafeExistingSymlink(target)) throw SecurityException("refusing to overwrite runtime symlink: $relative")
            Files.delete(target.toPath())
          }
          when {
            current.isDirectory -> target.mkdirs()
            current.isSymbolicLink -> {
              val link = current.linkName.replace('\\', '/')
              if (!isSafeSymlink(relative, link)) {
                throw SecurityException("unsafe symlink: $relative -> $link")
              }
              Files.createSymbolicLink(target.toPath(), java.nio.file.Paths.get(link))
            }
            current.isFile -> {
              if (current.size > MAX_ENTRY_BYTES || totalBytes + current.size > MAX_ARCHIVE_BYTES) {
                throw SecurityException("package archive is too large")
              }
              // 原子替换写入（2026-09-03 崩溃修复）：绝不能 truncate 覆盖写目标路径。
              // 引擎 node 运行时就 mmap 着 $PREFIX/lib 下的共享库（libicudata/libicui18n 等，
              // python 依赖链会重装 libicu）。直接覆盖写会让运行中引擎 SIGBUS(BUS_ADRERR)
              // 崩溃；写入中途被打断还会留下半写坏的 .so（linker "invalid shdr offset/size"，
              // 引擎重启 CANNOT LINK——logcat 实测 22:16:27 双故障）。改为：写同目录临时
              // 文件 → rename 原子替换。旧 inode 不被改动：运行中进程继续用完整旧映射，
              // 新进程加载完整新文件；中断只留下 tmp（finally 清理），目标文件要么旧要么新。
              val tmp = File(target.parentFile, "." + target.name + ".pkgtmp-" + java.util.UUID.randomUUID().toString().take(8))
              try {
                tmp.outputStream().use { output -> stream.copyTo(output) }
                if ((current.mode and 0x49) != 0) tmp.setExecutable(true, false)
                try {
                  Files.move(tmp.toPath(), target.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE)
                } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                  Files.move(tmp.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
                }
              } finally {
                if (tmp.exists()) tmp.delete()
              }
              totalBytes += current.size
            }
          }
          installed += "/$relative"
        }
        entry = stream.nextTarEntry
      }
    }
    return ExtractedFiles(installed, preexisting.distinct())
  }

  private fun ensureSafeParent(relative: String) {
    var current = prefix
    val parts = relative.split('/').dropLast(1)
    for (part in parts) {
      current = File(current, part)
      if (Files.isSymbolicLink(current.toPath())) {
        throw SecurityException("archive path enters symlink directory: $relative")
      }
    }
    current.mkdirs()
  }

  private fun isSafeExistingSymlink(target: File): Boolean {
    return try {
      val link = Files.readSymbolicLink(target.toPath())
      if (link.isAbsolute) return false
      val root = prefix.toPath().toAbsolutePath().normalize()
      val resolved = target.parentFile.toPath().resolve(link).normalize().toAbsolutePath()
      resolved == root || resolved.startsWith(root)
    } catch (_: Throwable) {
      false
    }
  }

  private fun isSafeSymlink(relative: String, link: String): Boolean {
    if (link.isEmpty() || link.startsWith('/')) return false
    val parent = File(relative).parent.orEmpty().replace('\\', '/')
    val combined = if (parent.isEmpty()) link else "$parent/$link"
    val normalized = java.nio.file.Paths.get(combined).normalize().toString().replace('\\', '/')
    return normalized.isNotEmpty() && normalized != "." && !normalized.startsWith("../") && normalized != ".."
  }

  private fun safeRelative(raw: String): String? {
    val cleaned = raw.replace('\\', '/').trimStart('/')
    if (cleaned.isEmpty() || cleaned.split('/').any { it == ".." }) return if (cleaned.isEmpty()) "" else null
    return cleaned
  }

  private fun safePrefixPath(raw: String): File? {
    val rel = safeRelative(raw) ?: return null
    if (rel.isEmpty()) return null
    return File(prefix, rel)
  }

  private fun managedOwns(rawPath: String, excluding: String? = null): Boolean {
    val wanted = safeRelative(rawPath) ?: return false
    if (wanted.isEmpty() || !managedInfoDir.isDirectory) return false
    return managedInfoDir.listFiles()?.any { list ->
      list.isFile && normalizeName(list.name.removeSuffix(".list")) != excluding &&
        list.readLines().any { line ->
          val owned = line.removePrefix("P ").trim()
          safeRelative(owned) == wanted
        }
    } == true
  }

  private fun register(entry: PackageEntry, extracted: ExtractedFiles) {
    managedInfoDir.mkdirs()
    val lines = extracted.paths.map { path ->
      if (path in extracted.preexisting) "P $path" else path
    }
    File(managedInfoDir, "${entry.name}.list").writeText(lines.joinToString("\n") + "\n")
    val current = readInstalled().associateBy { it.name }.toMutableMap()
    current[entry.name] = Installed(entry.name, entry.version, "install ok installed")
    writeStatus(current.values.toList())
  }

  private fun readInstalled(): List<Installed> = readStatusFile(managedStatusFile)

  private fun readBaseInstalled(): List<Installed> = readStatusFile(File(statusDir, "status"))

  private fun readStatusFile(file: File): List<Installed> {
    if (!file.isFile) return emptyList()
    val out = mutableListOf<Installed>()
    var name = ""
    var version = ""
    var status = ""
    fun flush() {
      if (name.isNotBlank()) out += Installed(name, version, status)
      name = ""; version = ""; status = ""
    }
    file.forEachLine { line ->
      if (line.isBlank()) flush()
      else if (line.startsWith("Package:")) name = normalizeName(line.substringAfter(':'))
      else if (line.startsWith("Version:")) version = line.substringAfter(':').trim()
      else if (line.startsWith("Status:")) status = line.substringAfter(':').trim()
    }
    flush()
    return out
  }

  private fun writeStatus(packages: List<Installed>) {
    managedDir.mkdirs()
    val text = packages.sortedBy { it.name }.joinToString("\n") {
      "Package: ${it.name}\nVersion: ${it.version}\nStatus: ${it.status}\n"
    }
    val temp = File(managedDir, ".status.tmp")
    FileOutputStream(temp).use { output ->
      output.write(if (text.isEmpty()) byteArrayOf() else "$text\n".toByteArray(Charsets.UTF_8))
      output.fd.sync()
    }
    if (!temp.renameTo(managedStatusFile)) {
      temp.delete()
      throw IllegalStateException("cannot commit package status")
    }
  }

  private fun parseIndex(bytes: ByteArray): Map<String, PackageEntry> {
    val text = bytes.toString(Charsets.UTF_8)
    val result = linkedMapOf<String, PackageEntry>()
    text.split(Regex("\\n\\s*\\n")).forEach { stanza ->
      val fields = linkedMapOf<String, String>()
      var last = ""
      stanza.lines().forEach { line ->
        if (line.startsWith(" ") || line.startsWith("\t")) fields[last] = (fields[last].orEmpty() + "\n" + line.trim()).trim()
        else {
          val p = line.indexOf(':')
          if (p > 0) { last = line.substring(0, p); fields[last] = line.substring(p + 1).trim() }
        }
      }
      val name = normalizeName(fields["Package"].orEmpty())
      val architecture = fields["Architecture"].orEmpty()
      if (name.isNotEmpty() && (architecture.isEmpty() || architecture == arch || architecture == "all")) {
        result[name] = PackageEntry(
          name,
          fields["Version"].orEmpty(),
          architecture,
          fields["Depends"].orEmpty(),
          fields["Filename"].orEmpty(),
          fields["SHA256"].orEmpty(),
          fields["Description"].orEmpty(),
        )
      }
    }
    return result
  }

  private fun httpGet(url: String): ByteArray {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 30_000
    connection.readTimeout = 180_000
    connection.setRequestProperty("User-Agent", "dsh-mobile-pkg/1.0")
    return try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        throw IllegalStateException("HTTP ${connection.responseCode} for repository index")
      }
      val length = connection.contentLengthLong
      if (length > MAX_INDEX_BYTES) throw IllegalStateException("repository index is too large")
      connection.inputStream.use { input ->
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          total += n
          if (total > MAX_INDEX_BYTES) throw IllegalStateException("repository index is too large")
          output.write(buffer, 0, n)
        }
        output.toByteArray()
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun httpDownloadToFile(url: String, target: File) {
    val tmp = File(target.parentFile, ".${target.name}.part")
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 30_000
    connection.readTimeout = 180_000
    connection.setRequestProperty("User-Agent", "dsh-mobile-pkg/1.0")
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        throw IllegalStateException("HTTP ${connection.responseCode} for package download")
      }
      val expected = connection.contentLengthLong
      if (expected > MAX_DEB_BYTES) throw IllegalStateException("package download is too large")
      connection.inputStream.use { input ->
        FileOutputStream(tmp).use { output ->
          val buffer = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            total += n
            if (total > MAX_DEB_BYTES) throw IllegalStateException("package download is too large")
            output.write(buffer, 0, n)
          }
          output.fd.sync()
          if (expected >= 0 && total != expected) throw IllegalStateException("truncated package download")
        }
      }
      if (target.exists() && !target.delete()) throw IllegalStateException("cannot replace package cache")
      if (!tmp.renameTo(target)) throw IllegalStateException("cannot commit package download")
    } finally {
      tmp.delete()
      connection.disconnect()
    }
  }

  companion object {
    private const val MAX_INDEX_BYTES = 64L * 1024 * 1024
    private const val MAX_DEB_BYTES = 256L * 1024 * 1024
    private const val MAX_ARCHIVE_BYTES = 512L * 1024 * 1024
    private const val MAX_ENTRY_BYTES = 256L * 1024 * 1024
    private const val MAX_ARCHIVE_ENTRIES = 50_000
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}

