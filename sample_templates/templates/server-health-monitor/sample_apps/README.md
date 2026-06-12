# Server Health Monitor sample senders

Small sample agents that send local server health metrics to ROSA:

- `server_health_agent.py`: Python, Windows/Linux, requires `psutil`.
- `Program.cs` + `ServerHealthAgent.csproj`: C#/.NET, Windows/Linux, no NuGet packages.

Both apps read the API URL from `rosa_api_url.txt` in the current directory. On first run they create it with:

```text
http://127.0.0.1:4177/api/IO123abcd%40simulate/SIM_SYNC/iotimeseries
```

You can paste any of these forms into the text file:

```text
http://127.0.0.1:4177/api/IO123abcd%40simulate/SIM_SYNC
http://127.0.0.1:4177/api/IO123abcd%40simulate/SIM_SYNC/iotelemetry
http://127.0.0.1:4177/api/IO123abcd%40simulate/SIM_SYNC/iotimeseries
```

The sender normalizes the final endpoint to `/iotimeseries`.

## Metrics

The apps send:

- `CPU_Percent`
- `RAM_Percent`
- `Network_In_Mbps`
- `Network_Out_Mbps`
- `Disk_Main_Used_GB`
- `Disk_Main_Total_GB`
- `CPU_Temperature_C` when Core Temp is available on Windows

Core Temp is optional. On Windows, keep Core Temp running and enable its shared memory option if you want CPU temperature. On Linux and on Windows without Core Temp, temperature is skipped and the other metrics continue to send.

## Python

Install the only dependency without admin rights:

```bash
python -m pip install --user psutil
```

Run once:

```bash
python server_health_agent.py --once
```

Run continuously every 5 seconds:

```bash
python server_health_agent.py
```

Custom interval/config:

```bash
python server_health_agent.py --interval 10 --config rosa_api_url.txt
```

## C#

Run the included Windows executable:

```powershell
.\ServerHealthAgent.exe --once
.\ServerHealthAgent.exe --interval 10
```

Build and run:

```bash
dotnet run --project ServerHealthAgent.csproj -- --once
dotnet run --project ServerHealthAgent.csproj -- --interval 10
```

Publish a small executable if needed:

```bash
dotnet publish ServerHealthAgent.csproj -c Release -r win-x64 --self-contained false
```
