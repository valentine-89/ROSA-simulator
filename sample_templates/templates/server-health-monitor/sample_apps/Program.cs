using System.Diagnostics;
using System.Globalization;
using System.IO.MemoryMappedFiles;
using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

internal static class Program
{
    private const string DefaultApiUrl = "http://127.0.0.1:4177/api/IO123abcd%40simulate/SIM_SYNC/iotimeseries";

    public static async Task<int> Main(string[] args)
    {
        var options = Options.Parse(args);
        if (options.ShowHelp)
        {
            Options.PrintHelp();
            return 0;
        }

        string url;
        try
        {
            url = LoadApiUrl(options.ConfigPath);
        }
        catch (Exception ex)
        {
            Console.WriteLine("Config error: " + ex.Message);
            return 2;
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        var sampler = new SystemSampler();
        Console.WriteLine("Config file: " + Path.GetFullPath(options.ConfigPath));
        Console.WriteLine("POST URL: " + url);

        while (true)
        {
            var started = Stopwatch.StartNew();
            var payload = await sampler.SampleAsync(CancellationToken.None);
            var temp = CoreTempReader.Read();
            if (temp.ValueCelsius.HasValue)
            {
                payload["CPU_Temperature_C"] = Math.Round(temp.ValueCelsius.Value, 1);
            }
            Console.WriteLine(temp.Status);

            try
            {
                var response = await http.PostAsJsonAsync(url, new
                {
                    ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    payload
                });
                var body = await response.Content.ReadAsStringAsync();
                if (response.IsSuccessStatusCode)
                {
                    Console.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} sent {payload.Count} fields: HTTP {(int)response.StatusCode} {Trim(body)}");
                }
                else
                {
                    Console.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} send failed: HTTP {(int)response.StatusCode} {Trim(body)}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} send failed: {ex.Message}");
            }

            if (options.Once)
            {
                break;
            }

            var delay = TimeSpan.FromSeconds(options.IntervalSeconds) - started.Elapsed;
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay);
            }
        }

        return 0;
    }

    private static string Trim(string text)
    {
        text = (text ?? string.Empty).ReplaceLineEndings(" ").Trim();
        return text.Length <= 160 ? text : text[..160];
    }

    private static string LoadApiUrl(string configPath)
    {
        if (!File.Exists(configPath))
        {
            File.WriteAllText(configPath, DefaultApiUrl + Environment.NewLine);
            return DefaultApiUrl;
        }

        var raw = File.ReadLines(configPath)
            .Select(line => line.Trim())
            .FirstOrDefault(line => line.Length > 0 && !line.StartsWith("#", StringComparison.Ordinal));
        if (string.IsNullOrWhiteSpace(raw))
        {
            File.WriteAllText(configPath, DefaultApiUrl + Environment.NewLine);
            return DefaultApiUrl;
        }

        var normalized = NormalizeApiUrl(raw);
        if (!string.Equals(raw, normalized, StringComparison.Ordinal))
        {
            File.WriteAllText(configPath, normalized + Environment.NewLine);
        }
        return normalized;
    }

    private static string NormalizeApiUrl(string raw)
    {
        var candidate = raw.Trim();
        if (!candidate.Contains("://", StringComparison.Ordinal))
        {
            var lower = candidate.ToLowerInvariant();
            candidate = lower.StartsWith("localhost", StringComparison.Ordinal)
                || lower.StartsWith("127.", StringComparison.Ordinal)
                || lower.StartsWith("[::1]", StringComparison.Ordinal)
                ? "http://" + candidate
                : "https://" + candidate;
        }

        var uri = new Uri(candidate, UriKind.Absolute);
        var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
        if (parts.Count >= 4 && IsRuntimeAction(parts[^1]))
        {
            parts[^1] = "iotimeseries";
        }
        else if (parts.Count >= 3 && string.Equals(parts[0], "api", StringComparison.OrdinalIgnoreCase))
        {
            parts.Add("iotimeseries");
        }
        else
        {
            throw new InvalidOperationException("API URL must look like /api/<sessionId>/<syncId>[/iotimeseries].");
        }

        var server = uri.GetComponents(UriComponents.SchemeAndServer, UriFormat.UriEscaped);
        return server + "/" + string.Join("/", parts);
    }

    private static bool IsRuntimeAction(string value)
    {
        return string.Equals(value, "iotelemetry", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "iotimeseries", StringComparison.OrdinalIgnoreCase);
    }
}

internal sealed record Options(bool Once, double IntervalSeconds, string ConfigPath, bool ShowHelp)
{
    public static Options Parse(string[] args)
    {
        var once = false;
        var interval = 5.0;
        var config = ProgramDefaults.Config;
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg is "--help" or "-h")
            {
                return new Options(false, interval, config, true);
            }
            if (arg == "--once")
            {
                once = true;
                continue;
            }
            if (arg == "--interval" && i + 1 < args.Length && double.TryParse(args[++i], NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
            {
                interval = Math.Max(1.0, parsed);
                continue;
            }
            if (arg == "--config" && i + 1 < args.Length)
            {
                config = args[++i];
            }
        }
        return new Options(once, interval, config, false);
    }

    public static void PrintHelp()
    {
        Console.WriteLine("Usage: ServerHealthAgent.exe [--once] [--interval seconds] [--config path]");
    }
}

internal static class ProgramDefaults
{
    public const string Config = "rosa_api_url.txt";
    public const double BytesPerMegabit = 125000.0;
    public const double Gb = 1024.0 * 1024.0 * 1024.0;
}

internal sealed class SystemSampler
{
    private readonly CpuSampler _cpu = new();
    private readonly NetworkSampler _network = new();

    public async Task<Dictionary<string, double>> SampleAsync(CancellationToken cancellationToken)
    {
        _network.Prime();
        var cpu = await _cpu.ReadPercentAsync(cancellationToken) ?? 0.0;
        var memory = MemoryReader.ReadPercent() ?? 0.0;
        var disk = DiskReader.ReadMainDisk();
        var network = _network.ReadMbps();

        return new Dictionary<string, double>
        {
            ["CPU_Percent"] = Math.Round(cpu, 1),
            ["RAM_Percent"] = Math.Round(memory, 1),
            ["Network_In_Mbps"] = Math.Round(network.InMbps, 3),
            ["Network_Out_Mbps"] = Math.Round(network.OutMbps, 3),
            ["Disk_Main_Used_GB"] = Math.Round(disk.UsedGb, 2),
            ["Disk_Main_Total_GB"] = Math.Round(disk.TotalGb, 2)
        };
    }
}

internal sealed class CpuSampler
{
    public async Task<double?> ReadPercentAsync(CancellationToken cancellationToken)
    {
        var before = CpuSnapshot.Read();
        if (before is null)
        {
            return null;
        }

        await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
        var after = CpuSnapshot.Read();
        if (after is null)
        {
            return null;
        }

        var total = after.Value.Total - before.Value.Total;
        var idle = after.Value.Idle - before.Value.Idle;
        if (total <= 0)
        {
            return null;
        }
        return Math.Clamp((1.0 - idle / total) * 100.0, 0.0, 100.0);
    }
}

internal readonly record struct CpuSnapshot(double Idle, double Total)
{
    public static CpuSnapshot? Read()
    {
        if (OperatingSystem.IsWindows())
        {
            return NativeMethods.GetSystemTimes(out var idle, out var kernel, out var user)
                ? new CpuSnapshot(idle.ToUInt64(), kernel.ToUInt64() + user.ToUInt64())
                : null;
        }

        if (OperatingSystem.IsLinux() && File.Exists("/proc/stat"))
        {
            var line = File.ReadLines("/proc/stat").FirstOrDefault();
            if (line is null || !line.StartsWith("cpu ", StringComparison.Ordinal))
            {
                return null;
            }
            var values = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1)
                .Select(value => double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0.0)
                .ToArray();
            if (values.Length < 4)
            {
                return null;
            }
            var idle = values[3] + (values.Length > 4 ? values[4] : 0.0);
            var total = values.Sum();
            return new CpuSnapshot(idle, total);
        }

        return null;
    }
}

internal static class MemoryReader
{
    public static double? ReadPercent()
    {
        if (OperatingSystem.IsWindows())
        {
            var status = new NativeMethods.MemoryStatusEx();
            return NativeMethods.GlobalMemoryStatusEx(status) ? status.MemoryLoad : null;
        }

        if (OperatingSystem.IsLinux() && File.Exists("/proc/meminfo"))
        {
            var values = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in File.ReadLines("/proc/meminfo"))
            {
                var parts = line.Split(':', 2);
                if (parts.Length != 2)
                {
                    continue;
                }
                var number = parts[1].Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
                if (double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
                {
                    values[parts[0]] = parsed;
                }
            }
            if (values.TryGetValue("MemTotal", out var total) && values.TryGetValue("MemAvailable", out var available) && total > 0)
            {
                return Math.Clamp((total - available) / total * 100.0, 0.0, 100.0);
            }
        }

        return null;
    }
}

internal static class DiskReader
{
    public static (double UsedGb, double TotalGb) ReadMainDisk()
    {
        var root = OperatingSystem.IsWindows()
            ? Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\"
            : "/";
        var drive = new DriveInfo(root);
        if (!drive.IsReady || drive.TotalSize <= 0)
        {
            return (0.0, 0.0);
        }
        var total = drive.TotalSize / ProgramDefaults.Gb;
        var used = (drive.TotalSize - drive.AvailableFreeSpace) / ProgramDefaults.Gb;
        return (used, total);
    }
}

internal sealed class NetworkSampler
{
    private (long Received, long Sent, DateTimeOffset Time)? _previous;

    public void Prime()
    {
        _previous ??= ReadTotals();
    }

    public (double InMbps, double OutMbps) ReadMbps()
    {
        var current = ReadTotals();
        if (_previous is not { } previous)
        {
            _previous = current;
            return (0.0, 0.0);
        }

        var seconds = Math.Max(0.001, (current.Time - previous.Time).TotalSeconds);
        var inMbps = Math.Max(0, current.Received - previous.Received) / seconds / ProgramDefaults.BytesPerMegabit;
        var outMbps = Math.Max(0, current.Sent - previous.Sent) / seconds / ProgramDefaults.BytesPerMegabit;
        _previous = current;
        return (inMbps, outMbps);
    }

    private static (long Received, long Sent, DateTimeOffset Time) ReadTotals()
    {
        long received = 0;
        long sent = 0;
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up
                || adapter.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            {
                continue;
            }
            var stats = adapter.GetIPv4Statistics();
            received += stats.BytesReceived;
            sent += stats.BytesSent;
        }
        return (received, sent, DateTimeOffset.UtcNow);
    }
}

internal static class CoreTempReader
{
    public static (double? ValueCelsius, string Status) Read()
    {
        if (!OperatingSystem.IsWindows())
        {
            return (null, "Core Temp: skipped on non-Windows.");
        }

        var mappings = new (string Name, Type Type)[]
        {
            ("CoreTempMappingObjectEx", typeof(CoreTempSharedDataEx)),
            ("Global\\CoreTempMappingObjectEx", typeof(CoreTempSharedDataEx)),
            ("CoreTempMappingObject", typeof(CoreTempSharedData)),
            ("Global\\CoreTempMappingObject", typeof(CoreTempSharedData))
        };

        var sawMapping = false;
        var lastError = string.Empty;
        foreach (var mapping in mappings)
        {
            try
            {
                using var mmf = MemoryMappedFile.OpenExisting(mapping.Name, MemoryMappedFileRights.Read);
                sawMapping = true;
                var value = mapping.Type == typeof(CoreTempSharedDataEx)
                    ? Extract(ReadStruct<CoreTempSharedDataEx>(mmf))
                    : Extract(ReadStruct<CoreTempSharedData>(mmf));
                if (value.HasValue)
                {
                    return (Math.Round(value.Value, 1), "Core Temp: available via " + mapping.Name + ".");
                }
                lastError = "shared memory did not contain a valid temperature";
            }
            catch (FileNotFoundException)
            {
            }
            catch (Exception ex)
            {
                sawMapping = true;
                lastError = ex.Message;
            }
        }

        return sawMapping
            ? (null, "Core Temp: read failed (" + (string.IsNullOrWhiteSpace(lastError) ? "unknown error" : lastError) + ").")
            : (null, "Core Temp: not running or shared memory disabled.");
    }

    private static T ReadStruct<T>(MemoryMappedFile mmf) where T : struct
    {
        var size = Marshal.SizeOf<T>();
        using var accessor = mmf.CreateViewAccessor(0, size, MemoryMappedFileAccess.Read);
        var buffer = new byte[size];
        accessor.ReadArray(0, buffer, 0, size);
        var handle = GCHandle.Alloc(buffer, GCHandleType.Pinned);
        try
        {
            return Marshal.PtrToStructure<T>(handle.AddrOfPinnedObject());
        }
        finally
        {
            handle.Free();
        }
    }

    private static double? Extract(ICoreTempData data)
    {
        var coreCount = Math.Max(1, data.CoreCount);
        var cpuCount = Math.Max(1, data.CpuCount);
        var total = Math.Clamp(coreCount * cpuCount, 1, 256);
        var values = new List<double>();
        for (var index = 0; index < total; index++)
        {
            var value = data.Temperatures[index];
            if (data.DeltaToTjMax)
            {
                var cpuIndex = Math.Min(127, index / coreCount);
                var tjMax = data.TjMax[cpuIndex];
                if (tjMax > 0)
                {
                    value = tjMax - value;
                }
            }
            if (data.Fahrenheit)
            {
                value = (value - 32.0f) * 5.0f / 9.0f;
            }
            if (value is >= -40.0f and <= 130.0f)
            {
                values.Add(value);
            }
        }
        return values.Count == 0 ? null : values.Average();
    }
}

internal interface ICoreTempData
{
    int CoreCount { get; }
    int CpuCount { get; }
    bool Fahrenheit { get; }
    bool DeltaToTjMax { get; }
    uint[] TjMax { get; }
    float[] Temperatures { get; }
}

[StructLayout(LayoutKind.Sequential, Pack = 4, CharSet = CharSet.Ansi)]
internal struct CoreTempSharedData : ICoreTempData
{
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
    public uint[] Load;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 128)]
    public uint[] TjMaxValues;
    public uint CoreCountValue;
    public uint CpuCountValue;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
    public float[] TempValues;
    public float Vid;
    public float CpuSpeed;
    public float FsbSpeed;
    public float Multiplier;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 100)]
    public string CpuName;
    public byte FahrenheitValue;
    public byte DeltaToTjMaxValue;

    public int CoreCount => (int)CoreCountValue;
    public int CpuCount => (int)CpuCountValue;
    public bool Fahrenheit => FahrenheitValue != 0;
    public bool DeltaToTjMax => DeltaToTjMaxValue != 0;
    public uint[] TjMax => TjMaxValues;
    public float[] Temperatures => TempValues;
}

[StructLayout(LayoutKind.Sequential, Pack = 4, CharSet = CharSet.Ansi)]
internal struct CoreTempSharedDataEx : ICoreTempData
{
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
    public uint[] Load;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 128)]
    public uint[] TjMaxValues;
    public uint CoreCountValue;
    public uint CpuCountValue;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
    public float[] TempValues;
    public float Vid;
    public float CpuSpeed;
    public float FsbSpeed;
    public float Multiplier;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 100)]
    public string CpuName;
    public byte FahrenheitValue;
    public byte DeltaToTjMaxValue;
    public byte TdpSupported;
    public byte PowerSupported;
    public uint StructVersion;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 128)]
    public uint[] Tdp;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 128)]
    public float[] Power;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
    public float[] Multipliers;

    public int CoreCount => (int)CoreCountValue;
    public int CpuCount => (int)CpuCountValue;
    public bool Fahrenheit => FahrenheitValue != 0;
    public bool DeltaToTjMax => DeltaToTjMaxValue != 0;
    public uint[] TjMax => TjMaxValues;
    public float[] Temperatures => TempValues;
}

internal static partial class NativeMethods
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetSystemTimes(out FileTime idleTime, out FileTime kernelTime, out FileTime userTime);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatusEx buffer);

    [StructLayout(LayoutKind.Sequential)]
    public struct FileTime
    {
        public uint LowDateTime;
        public uint HighDateTime;
        public ulong ToUInt64() => ((ulong)HighDateTime << 32) | LowDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public sealed class MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;

        public MemoryStatusEx()
        {
            Length = (uint)Marshal.SizeOf<MemoryStatusEx>();
        }
    }
}
