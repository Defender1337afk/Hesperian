using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using Microsoft.Win32;

namespace Hesperian.Setup
{
    public class Options
    {
        public string Dir;
        public bool Desktop = true;
        public bool StartMenu = true;
        public bool Purge;
    }

    public static class Engine
    {
        const string AppName = "Hesperian";
        const string AppExe = "Hesperian.exe";
        const string UninstallExe = "uninstall.exe";
        const string ManifestName = ".install-manifest";
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Hesperian";
        static readonly byte[] Magic = System.Text.Encoding.ASCII.GetBytes("HSPRPAY1");
        const int FooterSize = 16;

        public static string Version
        {
            get
            {
                var v = Assembly.GetExecutingAssembly().GetName().Version;
                return $"{v.Major}.{v.Minor}.{v.Build}";
            }
        }

        public static string SelfPath => Assembly.GetExecutingAssembly().Location;

        public static string DefaultDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);

        public static string DataDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName);

        public static string InitialDir()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                var path = key?.GetValue("InstallLocation") as string;
                return string.IsNullOrEmpty(path) ? DefaultDir : path;
            }
        }

        public static string NormalizeDir(string picked)
        {
            var full = Path.GetFullPath(picked);
            return string.Equals(Path.GetFileName(full.TrimEnd('\\')), AppName, StringComparison.OrdinalIgnoreCase)
                ? full
                : Path.Combine(full, AppName);
        }

        static long PayloadLength(FileStream exe)
        {
            if (exe.Length < FooterSize) return 0;
            exe.Seek(-FooterSize, SeekOrigin.End);
            var footer = new byte[FooterSize];
            exe.Read(footer, 0, FooterSize);
            for (int i = 0; i < Magic.Length; i++)
                if (footer[8 + i] != Magic[i]) return 0;
            return BitConverter.ToInt64(footer, 0);
        }

        public static bool HasPayload()
        {
            using (var exe = File.OpenRead(SelfPath)) return PayloadLength(exe) > 0;
        }

        public static bool IsAppRunning(string dir)
        {
            var target = Path.Combine(dir, AppExe);
            foreach (var process in Process.GetProcessesByName(AppName))
            {
                try
                {
                    if (string.Equals(process.MainModule?.FileName, target, StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch (Exception)
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return false;
        }

        public static void Install(Options o, Action<float, string> progress)
        {
            var dir = o.Dir;
            if (IsAppRunning(dir)) throw new InvalidOperationException("Hesperian сейчас запущен. Закройте его и повторите.");
            Directory.CreateDirectory(dir);
            var root = Path.GetFullPath(dir).TrimEnd('\\') + '\\';
            var written = new List<string>();

            using (var exe = File.OpenRead(SelfPath))
            {
                long length = PayloadLength(exe);
                if (length <= 0) throw new InvalidDataException("В установщике нет файлов программы. Скачайте его заново.");
                long start = exe.Length - FooterSize - length;
                using (var zip = new ZipArchive(new SubStream(exe, start, length), ZipArchiveMode.Read))
                {
                    long total = zip.Entries.Sum(e => e.Length);
                    long done = 0;
                    var buffer = new byte[1 << 20];
                    foreach (var entry in zip.Entries)
                    {
                        var dest = Path.GetFullPath(Path.Combine(root, entry.FullName));
                        if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException($"Недопустимый путь в архиве: {entry.FullName}");
                        if (entry.FullName.EndsWith("/")) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        using (var input = entry.Open())
                        using (var output = File.Create(dest))
                        {
                            int read;
                            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                output.Write(buffer, 0, read);
                                done += read;
                                progress(total > 0 ? (float)done / total * 0.97f : 0, entry.Name);
                            }
                        }
                        written.Add(dest.Substring(root.Length));
                    }
                }

                progress(0.98f, UninstallExe);
                long stubSize = exe.Length - FooterSize - length;
                exe.Seek(0, SeekOrigin.Begin);
                using (var stub = File.Create(Path.Combine(root, UninstallExe)))
                {
                    var buffer = new byte[1 << 20];
                    long left = stubSize;
                    while (left > 0)
                    {
                        int read = exe.Read(buffer, 0, (int)Math.Min(buffer.Length, left));
                        if (read <= 0) throw new EndOfStreamException();
                        stub.Write(buffer, 0, read);
                        left -= read;
                    }
                }
            }
            written.Add(UninstallExe);

            var manifest = Path.Combine(root, ManifestName);
            if (File.Exists(manifest))
            {
                var current = new HashSet<string>(written, StringComparer.OrdinalIgnoreCase);
                foreach (var old in File.ReadAllLines(manifest).Where(l => !current.Contains(l)))
                    DeleteInside(root, old);
            }
            File.WriteAllLines(manifest, written);

            progress(0.99f, "Ярлыки");
            var app = Path.Combine(root, AppExe);
            SetShortcut(Environment.SpecialFolder.DesktopDirectory, app, o.Desktop);
            SetShortcut(Environment.SpecialFolder.Programs, app, o.StartMenu);
            Register(root, app, written.Sum(f => new FileInfo(Path.Combine(root, f)).Length));
            progress(1f, "");
        }

        public static void Uninstall(Options o, Action<float, string> progress)
        {
            var root = Path.GetFullPath(o.Dir).TrimEnd('\\') + '\\';
            if (IsAppRunning(root.TrimEnd('\\'))) throw new InvalidOperationException("Hesperian сейчас запущен. Закройте его и повторите.");

            var manifest = Path.Combine(root, ManifestName);
            if (!File.Exists(manifest)) throw new FileNotFoundException("Не найден список установленных файлов. Удалите папку вручную.");
            var files = File.ReadAllLines(manifest).Where(f => !string.Equals(f, UninstallExe, StringComparison.OrdinalIgnoreCase)).ToList();
            for (int i = 0; i < files.Count; i++)
            {
                DeleteInside(root, files[i]);
                progress((float)(i + 1) / files.Count * 0.9f, Path.GetFileName(files[i]));
            }
            File.Delete(manifest);
            RemoveEmptyDirs(root);

            SetShortcut(Environment.SpecialFolder.DesktopDirectory, null, false);
            SetShortcut(Environment.SpecialFolder.Programs, null, false);
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);

            if (o.Purge)
            {
                progress(0.95f, "Сборки и настройки");
                if (Directory.Exists(DataDir)) Directory.Delete(DataDir, true);
            }
            progress(1f, "");
        }

        public static void ScheduleSelfRemoval(string dir)
        {
            var self = SelfPath;
            var script = $"/c ping -n 3 127.0.0.1 >nul & del /f /q \"{self}\" & rmdir \"{dir.TrimEnd('\\')}\"";
            Process.Start(new ProcessStartInfo("cmd.exe", script) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }

        public static void LaunchApp(string dir) =>
            Process.Start(new ProcessStartInfo(Path.Combine(dir, AppExe)) { WorkingDirectory = dir, UseShellExecute = true });

        static void DeleteInside(string root, string relative)
        {
            var path = Path.GetFullPath(Path.Combine(root, relative));
            if (path.StartsWith(root, StringComparison.OrdinalIgnoreCase) && File.Exists(path)) File.Delete(path);
        }

        static void RemoveEmptyDirs(string root)
        {
            foreach (var dir in Directory.GetDirectories(root, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length))
                if (!Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
        }

        static string ShortcutPath(Environment.SpecialFolder folder) =>
            Path.Combine(Environment.GetFolderPath(folder), AppName + ".lnk");

        static void SetShortcut(Environment.SpecialFolder folder, string target, bool wanted)
        {
            var path = ShortcutPath(folder);
            if (!wanted)
            {
                if (File.Exists(path)) File.Delete(path);
                return;
            }
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            dynamic link = shell.CreateShortcut(path);
            link.TargetPath = target;
            link.WorkingDirectory = Path.GetDirectoryName(target);
            link.IconLocation = target + ",0";
            link.Description = "Лаунчер Minecraft";
            link.Save();
        }

        static void Register(string root, string app, long bytes)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                var uninstall = Path.Combine(root, UninstallExe);
                key.SetValue("DisplayName", AppName);
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", AppName);
                key.SetValue("DisplayIcon", app);
                key.SetValue("InstallLocation", root.TrimEnd('\\'));
                key.SetValue("UninstallString", $"\"{uninstall}\" --uninstall");
                key.SetValue("QuietUninstallString", $"\"{uninstall}\" --uninstall --silent");
                key.SetValue("EstimatedSize", (int)(bytes / 1024), RegistryValueKind.DWord);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
    }

    sealed class SubStream : Stream
    {
        readonly Stream _base;
        readonly long _start, _length;
        long _pos;

        public SubStream(Stream baseStream, long start, long length)
        {
            _base = baseStream;
            _start = start;
            _length = length;
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => _length;
        public override long Position { get => _pos; set => _pos = value; }
        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override int Read(byte[] buffer, int offset, int count)
        {
            long left = _length - _pos;
            if (left <= 0) return 0;
            _base.Seek(_start + _pos, SeekOrigin.Begin);
            int read = _base.Read(buffer, offset, (int)Math.Min(count, left));
            _pos += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            _pos = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? _pos + offset : _length + offset;
            return _pos;
        }
    }
}
