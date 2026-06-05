using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace RosaSimulatorLauncher
{
    internal static class Program
    {
        private const int DefaultPort = 4177;
        private const int BoxWidth = 76;
        private const string DefaultNodeVersion = "v24.14.0";
        private const string DefaultNodeZipUrl = "https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip";
        private const int JobObjectExtendedLimitInformationClass = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private static Process serverProcess;
        private static IntPtr jobHandle = IntPtr.Zero;
        private static bool stopping;

        private sealed class NodeRuntime
        {
            public string NodeExe = "";
            public string NpmCmd = "";
            public string Version = "";
            public string Source = "";
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public UInt64 ReadOperationCount;
            public UInt64 WriteOperationCount;
            public UInt64 OtherOperationCount;
            public UInt64 ReadTransferCount;
            public UInt64 WriteTransferCount;
            public UInt64 OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectBasicLimitInformation
        {
            public Int64 PerProcessUserTimeLimit;
            public Int64 PerJobUserTimeLimit;
            public UInt32 LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public UInt32 ActiveProcessLimit;
            public UIntPtr Affinity;
            public UInt32 PriorityClass;
            public UInt32 SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll")]
        private static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [STAThread]
        private static void Main()
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string logDir = Path.Combine(root, "logs");
            Directory.CreateDirectory(logDir);
            string logPath = Path.Combine(logDir, "ROSA-simulator.log");

            try
            {
                Dictionary<string, string> env = ReadEnvFile(Path.Combine(root, "ROSA-simulator.env"));
                int port = ParsePort(GetValue(env, "PORT"), DefaultPort);
                string url = "http://localhost:" + port;

                Console.Title = "ROSA-simulator";
                Console.OutputEncoding = Encoding.UTF8;
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

                PrintStep("ROSA-SIMULATOR DANG CHUAN BI", "ROSA-SIMULATOR IS PREPARING");
                PrintInfo("THU MUC APP", "APP FOLDER", root);
                PrintInfo("DIA CHI WEB", "WEB ADDRESS", url);

                EnsureSourceFiles(root);

                if (IsPortOpen(port))
                {
                    PrintStep("PORT DANG DUOC SU DUNG", "PORT IS ALREADY IN USE");
                    PrintInfo("DANG MO TRANG DANG CHAY", "OPENING EXISTING PAGE", url);
                    OpenBrowser(url);
                    Console.WriteLine();
                    Console.WriteLine("Press Enter to close this launcher window.");
                    Console.ReadLine();
                    return;
                }

                NodeRuntime node = ResolveNodeRuntime();
                string dependenciesDir = EnsureDependencies(root, node);

                RegisterShutdownHandlers();
                serverProcess = StartServer(root, env, node, dependenciesDir, logPath);
                if (!WaitForPort(port, TimeSpan.FromSeconds(18)))
                {
                    StopServer();
                    PrintStep("SERVER KHONG KHOI DONG DUOC", "SERVER DID NOT START");
                    PrintInfo("XEM LOG", "CHECK LOG", logPath);
                    Console.WriteLine("Press Enter to close.");
                    Console.ReadLine();
                    return;
                }

                PrintStep("SERVER DA SAN SANG", "SERVER IS READY");
                PrintInfo("DANG MO TRINH DUYET", "OPENING BROWSER", url);
                OpenBrowser(url);
                Console.WriteLine();
                Console.WriteLine("Server is running. Keep this terminal open while testing.");
                Console.WriteLine("Press Ctrl+C or close this terminal window to stop ROSA-simulator.");
                Console.WriteLine();
                serverProcess.WaitForExit();
            }
            catch (Exception ex)
            {
                try
                {
                    File.AppendAllText(logPath, DateTime.Now.ToString("s") + " " + ex + Environment.NewLine);
                }
                catch
                {
                    // Ignore logging failures.
                }
                PrintStep("LOI ROSA-SIMULATOR", "ROSA-SIMULATOR ERROR");
                Console.WriteLine(ex.Message);
                Console.WriteLine();
                Console.WriteLine("Press Enter to close.");
                Console.ReadLine();
            }
            finally
            {
                StopServer();
            }
        }

        private static void EnsureSourceFiles(string root)
        {
            PrintStep("KIEM TRA SOURCE CODE", "CHECKING SOURCE CODE");
            string[] required = new string[]
            {
                "server.js",
                "package.json",
                "package-lock.json",
                Path.Combine("src", "store.js"),
                Path.Combine("simulator_ui", "index.html"),
                Path.Combine("sample_templates", "manifest.json")
            };
            foreach (string item in required)
            {
                string filePath = Path.Combine(root, item);
                if (!File.Exists(filePath)) throw new FileNotFoundException("Required source file was not found.", filePath);
            }
            PrintInfo("SOURCE CODE", "SOURCE CODE", "OK");
        }

        private static NodeRuntime ResolveNodeRuntime()
        {
            PrintStep("KIEM TRA NODE.JS", "CHECKING NODE.JS");
            NodeRuntime systemNode = ResolveSystemNode();
            if (systemNode != null)
            {
                PrintInfo("DUNG NODE DA CAI", "USING INSTALLED NODE", systemNode.Version);
                return systemNode;
            }

            PrintInfo("NODE CHUA CO HOAC KHONG HOP LE", "NODE IS MISSING OR INVALID", "NEED PORTABLE NODE");
            return EnsurePortableNode();
        }

        private static NodeRuntime ResolveSystemNode()
        {
            string nodeExe = FindOnPath("node.exe");
            string npmCmd = FindOnPath("npm.cmd");
            if (String.IsNullOrWhiteSpace(nodeExe) || String.IsNullOrWhiteSpace(npmCmd)) return null;

            string version = RunAndCapture(nodeExe, "-p \"process.versions.node\"", Path.GetDirectoryName(nodeExe));
            int major = ParseMajorVersion(version);
            if (major < 20 || major > 26) return null;

            return new NodeRuntime
            {
                NodeExe = nodeExe,
                NpmCmd = npmCmd,
                Version = "v" + version.Trim().TrimStart('v'),
                Source = "system"
            };
        }

        private static NodeRuntime EnsurePortableNode()
        {
            string cacheRoot = CacheRoot();
            string portableRoot = Path.Combine(cacheRoot, "runtime", "node-" + DefaultNodeVersion + "-win-x64");
            string nodeExe = Path.Combine(portableRoot, "node.exe");
            string npmCmd = Path.Combine(portableRoot, "npm.cmd");

            if (File.Exists(nodeExe) && File.Exists(npmCmd))
            {
                PrintStep("DUNG NODE PORTABLE DA LUU", "USING CACHED PORTABLE NODE");
                return new NodeRuntime { NodeExe = nodeExe, NpmCmd = npmCmd, Version = DefaultNodeVersion, Source = "portable-cache" };
            }

            PrintStep("TAI NODE PORTABLE", "DOWNLOADING PORTABLE NODE");
            string nodeUrl = Environment.GetEnvironmentVariable("ROSA_NODE_ZIP_URL");
            if (String.IsNullOrWhiteSpace(nodeUrl)) nodeUrl = DefaultNodeZipUrl;
            PrintInfo("URL", "URL", nodeUrl);

            string downloadDir = Path.Combine(cacheRoot, "downloads");
            Directory.CreateDirectory(downloadDir);
            string zipPath = Path.Combine(downloadDir, "node-" + DefaultNodeVersion + "-win-x64.zip");
            using (WebClient client = new WebClient())
            {
                client.DownloadFile(nodeUrl, zipPath);
            }

            PrintStep("GIAI NEN NODE PORTABLE", "EXTRACTING PORTABLE NODE");
            string tempRoot = Path.Combine(cacheRoot, "runtime", "_extract-" + Guid.NewGuid().ToString("N"));
            RemoveTree(tempRoot);
            Directory.CreateDirectory(tempRoot);
            ZipFile.ExtractToDirectory(zipPath, tempRoot);

            string extractedNode = FindFile(tempRoot, "node.exe");
            if (String.IsNullOrWhiteSpace(extractedNode)) throw new FileNotFoundException("node.exe was not found in downloaded Node ZIP.");
            string extractedRoot = Path.GetDirectoryName(extractedNode);

            RemoveTree(portableRoot);
            Directory.CreateDirectory(Path.GetDirectoryName(portableRoot));
            Directory.Move(extractedRoot, portableRoot);
            RemoveTree(tempRoot);

            if (!File.Exists(nodeExe) || !File.Exists(npmCmd)) throw new FileNotFoundException("Portable Node was extracted but node.exe/npm.cmd was not found.");
            PrintInfo("NODE PORTABLE", "PORTABLE NODE", portableRoot);
            return new NodeRuntime { NodeExe = nodeExe, NpmCmd = npmCmd, Version = DefaultNodeVersion, Source = "portable-cache" };
        }

        private static string EnsureDependencies(string root, NodeRuntime node)
        {
            PrintStep("KIEM TRA THU VIEN NODE", "CHECKING NODE DEPENDENCIES");
            string packageJson = Path.Combine(root, "package.json");
            string packageLock = Path.Combine(root, "package-lock.json");
            string dependencyKey = ShortHash(packageJson, packageLock, node.Version);
            string depsRoot = Path.Combine(CacheRoot(), "dependencies", dependencyKey);
            string nodeModules = Path.Combine(depsRoot, "node_modules");
            string sqliteNative = Path.Combine(nodeModules, "better-sqlite3", "build", "Release", "better_sqlite3.node");

            if (File.Exists(sqliteNative))
            {
                PrintInfo("THU VIEN", "DEPENDENCIES", "OK");
                return nodeModules;
            }

            PrintStep("CAI DAT THU VIEN NODE", "INSTALLING NODE DEPENDENCIES");
            PrintInfo("LAN DAU CAN INTERNET", "FIRST RUN REQUIRES INTERNET", depsRoot);
            RemoveTree(depsRoot);
            Directory.CreateDirectory(depsRoot);
            File.Copy(packageJson, Path.Combine(depsRoot, "package.json"), true);
            File.Copy(packageLock, Path.Combine(depsRoot, "package-lock.json"), true);

            Dictionary<string, string> installEnv = NodeEnvironment(node, nodeModules);
            RunProcess(node.NpmCmd, "ci --omit=dev --ignore-scripts --no-audit --no-fund", depsRoot, installEnv);

            string prebuildScript = Path.Combine(nodeModules, "prebuild-install", "bin.js");
            string betterSqliteDir = Path.Combine(nodeModules, "better-sqlite3");
            if (!File.Exists(prebuildScript)) throw new FileNotFoundException("prebuild-install was not installed.", prebuildScript);
            if (!Directory.Exists(betterSqliteDir)) throw new DirectoryNotFoundException("better-sqlite3 was not installed.");
            RunProcess(node.NodeExe, Quote(prebuildScript), betterSqliteDir, installEnv);

            if (!File.Exists(sqliteNative)) throw new FileNotFoundException("better-sqlite3 native binary was not installed.", sqliteNative);
            PrintInfo("THU VIEN", "DEPENDENCIES", "OK");
            return nodeModules;
        }

        private static Process StartServer(string root, Dictionary<string, string> env, NodeRuntime node, string nodeModules, string logPath)
        {
            PrintStep("KHOI DONG SERVER LOCAL", "STARTING LOCAL SERVER");
            string serverPath = Path.Combine(root, "server.js");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = node.NodeExe;
            psi.Arguments = Quote(serverPath);
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            foreach (KeyValuePair<string, string> item in env)
            {
                psi.EnvironmentVariables[item.Key] = item.Value;
            }
            foreach (KeyValuePair<string, string> item in NodeEnvironment(node, nodeModules))
            {
                psi.EnvironmentVariables[item.Key] = item.Value;
            }

            Process process = new Process();
            process.StartInfo = psi;
            process.EnableRaisingEvents = false;
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { PrintAndLog(logPath, args.Data); };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { PrintAndLog(logPath, args.Data); };
            process.Start();
            AttachToKillOnCloseJob(process);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        private static Dictionary<string, string> NodeEnvironment(NodeRuntime node, string nodeModules)
        {
            string nodeDir = Path.GetDirectoryName(node.NodeExe);
            string existingPath = Environment.GetEnvironmentVariable("PATH") ?? "";
            Dictionary<string, string> env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            env["PATH"] = nodeDir + Path.PathSeparator + existingPath;
            env["NODE_PATH"] = nodeModules;
            env["ROSA_SIMULATOR_NODE_MODULES"] = nodeModules;
            return env;
        }

        private static void PrintStep(string vi, string en)
        {
            Console.WriteLine();
            string border = new string('#', BoxWidth);
            Console.WriteLine(border);
            Console.WriteLine(BoxLine("VI: " + vi));
            Console.WriteLine(BoxLine("EN: " + en));
            Console.WriteLine(border);
        }

        private static void PrintInfo(string viLabel, string enLabel, string value)
        {
            Console.WriteLine(BoxLine("VI: " + viLabel + " = " + value));
            Console.WriteLine(BoxLine("EN: " + enLabel + " = " + value));
        }

        private static string BoxLine(string value)
        {
            string text = value ?? "";
            int inner = BoxWidth - 4;
            if (text.Length > inner) text = text.Substring(0, Math.Max(0, inner - 3)) + "...";
            return "# " + text.PadRight(inner) + " #";
        }

        private static string CacheRoot()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (String.IsNullOrWhiteSpace(localAppData)) localAppData = Path.GetTempPath();
            string root = Path.Combine(localAppData, "ROSA-simulator");
            Directory.CreateDirectory(root);
            return root;
        }

        private static string ShortHash(string packageJson, string packageLock, string nodeVersion)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] first = File.ReadAllBytes(packageJson);
                byte[] second = File.ReadAllBytes(packageLock);
                byte[] third = Encoding.UTF8.GetBytes(nodeVersion ?? "");
                byte[] all = new byte[first.Length + second.Length + third.Length];
                Buffer.BlockCopy(first, 0, all, 0, first.Length);
                Buffer.BlockCopy(second, 0, all, first.Length, second.Length);
                Buffer.BlockCopy(third, 0, all, first.Length + second.Length, third.Length);
                byte[] hash = sha.ComputeHash(all);
                StringBuilder builder = new StringBuilder();
                for (int i = 0; i < 12; i += 1) builder.Append(hash[i].ToString("x2"));
                return "node-" + Sanitize(nodeVersion) + "-" + builder.ToString();
            }
        }

        private static string Sanitize(string value)
        {
            StringBuilder builder = new StringBuilder();
            foreach (char ch in (value ?? ""))
            {
                builder.Append(Char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.' ? ch : '_');
            }
            return builder.ToString();
        }

        private static string FindOnPath(string fileName)
        {
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string rawPath in pathValue.Split(Path.PathSeparator))
            {
                string dir = rawPath.Trim().Trim('"');
                if (String.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir, fileName);
                    if (File.Exists(candidate)) return candidate;
                }
                catch
                {
                    // Ignore invalid PATH entries.
                }
            }
            return "";
        }

        private static string FindFile(string root, string fileName)
        {
            if (!Directory.Exists(root)) return "";
            foreach (string filePath in Directory.GetFiles(root, fileName, SearchOption.AllDirectories))
            {
                return filePath;
            }
            return "";
        }

        private static string RunAndCapture(string fileName, string arguments, string workingDirectory)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = arguments;
            psi.WorkingDirectory = workingDirectory;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            using (Process process = Process.Start(psi))
            {
                string output = process.StandardOutput.ReadToEnd();
                process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) return "";
                return output.Trim();
            }
        }

        private static void RunProcess(string fileName, string arguments, string workingDirectory, Dictionary<string, string> env)
        {
            PrintInfo("LENH", "COMMAND", Path.GetFileName(fileName) + " " + arguments);
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = arguments;
            psi.WorkingDirectory = workingDirectory;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = false;
            foreach (KeyValuePair<string, string> item in env)
            {
                psi.EnvironmentVariables[item.Key] = item.Value;
            }

            using (Process process = new Process())
            {
                process.StartInfo = psi;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { if (!String.IsNullOrEmpty(args.Data)) Console.WriteLine("[BOOTSTRAP] " + args.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { if (!String.IsNullOrEmpty(args.Data)) Console.WriteLine("[BOOTSTRAP] " + args.Data); };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException("Command failed: " + Path.GetFileName(fileName) + " " + arguments);
            }
        }

        private static int ParseMajorVersion(string version)
        {
            string text = (version ?? "").Trim().TrimStart('v');
            string[] parts = text.Split('.');
            int major;
            if (parts.Length <= 0 || !Int32.TryParse(parts[0], out major)) return 0;
            return major;
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";
        }

        private static void RemoveTree(string path)
        {
            if (!Directory.Exists(path)) return;
            for (int attempt = 1; attempt <= 5; attempt += 1)
            {
                try
                {
                    Directory.Delete(path, true);
                    return;
                }
                catch
                {
                    if (attempt >= 5) throw;
                    Thread.Sleep(250 * attempt);
                }
            }
        }

        private static void RegisterShutdownHandlers()
        {
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs args)
            {
                args.Cancel = true;
                StopServer();
                Environment.Exit(0);
            };
            AppDomain.CurrentDomain.ProcessExit += delegate
            {
                StopServer();
            };
        }

        private static void OpenBrowser(string url)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = url;
            psi.UseShellExecute = true;
            Process.Start(psi);
        }

        private static string GetValue(Dictionary<string, string> env, string key)
        {
            string value;
            if (env.TryGetValue(key, out value)) return value;
            return Environment.GetEnvironmentVariable(key) ?? "";
        }

        private static int ParsePort(string value, int fallback)
        {
            int port;
            if (!Int32.TryParse(value, out port)) return fallback;
            return port > 0 && port < 65536 ? port : fallback;
        }

        private static Dictionary<string, string> ReadEnvFile(string filePath)
        {
            Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!File.Exists(filePath)) return result;

            foreach (string rawLine in File.ReadAllLines(filePath))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                int separator = line.IndexOf('=');
                if (separator <= 0) continue;
                string key = line.Substring(0, separator).Trim();
                string value = line.Substring(separator + 1).Trim().Trim('"');
                if (key.Length > 0) result[key] = value;
            }
            return result;
        }

        private static void AttachToKillOnCloseJob(Process process)
        {
            if (jobHandle == IntPtr.Zero)
            {
                jobHandle = CreateJobObject(IntPtr.Zero, null);
                if (jobHandle == IntPtr.Zero) return;

                JobObjectExtendedLimitInformation info = new JobObjectExtendedLimitInformation();
                info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
                int length = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
                IntPtr infoPtr = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(info, infoPtr, false);
                    SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformationClass, infoPtr, (uint)length);
                }
                finally
                {
                    Marshal.FreeHGlobal(infoPtr);
                }
            }
            AssignProcessToJobObject(jobHandle, process.Handle);
        }

        private static void PrintAndLog(string logPath, string line)
        {
            if (String.IsNullOrEmpty(line)) return;
            Console.WriteLine("[SERVER] " + line);
            try
            {
                File.AppendAllText(logPath, DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
            }
            catch
            {
                // Ignore logging failures.
            }
        }

        private static void StopServer()
        {
            if (stopping) return;
            stopping = true;
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    PrintStep("DANG DUNG SERVER", "STOPPING SERVER");
                    serverProcess.Kill();
                    serverProcess.WaitForExit(3000);
                }
            }
            catch
            {
                // Ignore shutdown failures.
            }
            try
            {
                if (jobHandle != IntPtr.Zero)
                {
                    CloseHandle(jobHandle);
                    jobHandle = IntPtr.Zero;
                }
            }
            catch
            {
                // Ignore job cleanup failures.
            }
        }

        private static bool WaitForPort(int port, TimeSpan timeout)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (watch.Elapsed < timeout)
            {
                if (IsPortOpen(port)) return true;
                Thread.Sleep(250);
            }
            return false;
        }

        private static bool IsPortOpen(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool connected = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(250));
                    if (!connected) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
