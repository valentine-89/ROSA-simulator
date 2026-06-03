using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

namespace RosaSimulatorLauncher
{
    internal static class Program
    {
        private const int DefaultPort = 4177;
        private const int JobObjectExtendedLimitInformationClass = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private static Process serverProcess;
        private static IntPtr jobHandle = IntPtr.Zero;
        private static bool stopping;

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
                Console.OutputEncoding = System.Text.Encoding.UTF8;
                PrintBanner(url, root);

                if (IsPortOpen(port))
                {
                    Console.WriteLine("Port " + port + " is already in use. Opening the existing simulator page.");
                    Console.WriteLine("If this is not ROSA-simulator, close the other app or change PORT in ROSA-simulator.env.");
                    OpenBrowser(url);
                    Console.WriteLine();
                    Console.WriteLine("Press Enter to close this launcher window.");
                    Console.ReadLine();
                    return;
                }

                RegisterShutdownHandlers();
                serverProcess = StartServer(root, env, logPath);
                if (!WaitForPort(port, TimeSpan.FromSeconds(12)))
                {
                    StopServer();
                    Console.WriteLine();
                    Console.WriteLine("ROSA-simulator did not start. Check log file:");
                    Console.WriteLine(logPath);
                    Console.WriteLine("Press Enter to close.");
                    Console.ReadLine();
                    return;
                }

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
                Console.WriteLine("ROSA-simulator error:");
                Console.WriteLine(ex.Message);
                Console.WriteLine("Press Enter to close.");
                Console.ReadLine();
            }
            finally
            {
                StopServer();
            }
        }

        private static void PrintBanner(string url, string root)
        {
            string[] lines = new string[]
            {
                "ROSA-simulator is starting",
                "Web address : " + url,
                "App folder  : " + root,
                "Keep this terminal open while using the simulator.",
                "Close this terminal to stop the web server."
            };
            int width = 0;
            foreach (string line in lines)
            {
                if (line.Length > width) width = line.Length;
            }
            width += 4;
            string border = "+" + new string('-', width) + "+";
            Console.WriteLine();
            Console.WriteLine(border);
            foreach (string line in lines)
            {
                Console.WriteLine("|  " + line.PadRight(width - 2) + "|");
            }
            Console.WriteLine(border);
            Console.WriteLine();
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
            return env.TryGetValue(key, out value) ? value : "";
        }

        private static int ParsePort(string value, int fallback)
        {
            int port;
            if (!int.TryParse(value, out port)) return fallback;
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

        private static string ResolveNodeExe(string root)
        {
            string bundled = Path.Combine(root, "runtime", "node.exe");
            if (File.Exists(bundled)) return bundled;

            string adjacent = Path.Combine(root, "node.exe");
            if (File.Exists(adjacent)) return adjacent;

            return "node.exe";
        }

        private static Process StartServer(string root, Dictionary<string, string> env, string logPath)
        {
            string serverPath = Path.Combine(root, "server.js");
            if (!File.Exists(serverPath)) throw new FileNotFoundException("server.js was not found.", serverPath);

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = ResolveNodeExe(root);
            psi.Arguments = "\"" + serverPath + "\"";
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            foreach (KeyValuePair<string, string> item in env)
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
            Console.WriteLine("[server] " + line);
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
                    Console.WriteLine();
                    Console.WriteLine("Stopping ROSA-simulator...");
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
