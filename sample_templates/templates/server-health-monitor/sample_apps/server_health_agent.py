#!/usr/bin/env python3
"""Sample sender for the ROSA Server Health Monitor template."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import platform
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Optional, Tuple

DEFAULT_API_URL = "http://127.0.0.1:4177/api/IO123abcd%40simulate/SIM_SYNC/iotimeseries"
DEFAULT_CONFIG = "rosa_api_url.txt"
BYTES_PER_MEGABIT = 125000.0
GB = 1024.0 ** 3


class CoreTempSharedData(ctypes.Structure):
    _pack_ = 4
    _fields_ = [
        ("uiLoad", ctypes.c_uint32 * 256),
        ("uiTjMax", ctypes.c_uint32 * 128),
        ("uiCoreCnt", ctypes.c_uint32),
        ("uiCPUCnt", ctypes.c_uint32),
        ("fTemp", ctypes.c_float * 256),
        ("fVID", ctypes.c_float),
        ("fCPUSpeed", ctypes.c_float),
        ("fFSBSpeed", ctypes.c_float),
        ("fMultiplier", ctypes.c_float),
        ("sCPUName", ctypes.c_char * 100),
        ("ucFahrenheit", ctypes.c_uint8),
        ("ucDeltaToTjMax", ctypes.c_uint8),
    ]


class CoreTempSharedDataEx(ctypes.Structure):
    _pack_ = 4
    _fields_ = CoreTempSharedData._fields_ + [
        ("ucTdpSupported", ctypes.c_uint8),
        ("ucPowerSupported", ctypes.c_uint8),
        ("uiStructVersion", ctypes.c_uint32),
        ("uiTdp", ctypes.c_uint32 * 128),
        ("fPower", ctypes.c_float * 128),
        ("fMultipliers", ctypes.c_float * 256),
    ]


def first_url_from_file(path: Path) -> str:
    if not path.exists():
        path.write_text(DEFAULT_API_URL + "\n", encoding="utf-8")
        return DEFAULT_API_URL
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped
    path.write_text(DEFAULT_API_URL + "\n", encoding="utf-8")
    return DEFAULT_API_URL


def add_default_scheme(raw: str) -> str:
    if "://" in raw:
        return raw
    lowered = raw.lower()
    if lowered.startswith(("localhost", "127.", "[::1]")):
        return "http://" + raw
    return "https://" + raw


def normalize_api_url(raw: str) -> str:
    candidate = add_default_scheme(raw.strip())
    parsed = urllib.parse.urlsplit(candidate)
    parts = [part for part in parsed.path.split("/") if part]
    lowered = [part.lower() for part in parts]
    if len(parts) >= 4 and lowered[-1] in ("iotelemetry", "iotimeseries"):
        parts[-1] = "iotimeseries"
    elif len(parts) >= 3 and lowered[0] == "api":
        parts.append("iotimeseries")
    else:
        raise ValueError("API URL must look like /api/<sessionId>/<syncId>[/iotimeseries].")
    normalized_path = "/" + "/".join(parts)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, normalized_path, "", ""))


def load_api_url(config_path: str) -> Tuple[Path, str]:
    path = Path(config_path).expanduser()
    raw = first_url_from_file(path)
    normalized = normalize_api_url(raw)
    if raw.strip() != normalized:
        path.write_text(normalized + "\n", encoding="utf-8")
    return path, normalized


class SystemSampler:
    def __init__(self, psutil_module, interval_hint: float) -> None:
        self.psutil = psutil_module
        self.interval_hint = max(1.0, interval_hint)
        self.previous_net = None
        self.previous_net_time = 0.0

    def _disk_root(self) -> str:
        if os.name == "nt":
            return (os.environ.get("SystemDrive") or "C:") + "\\"
        return "/"

    def _network_rates(self) -> Tuple[float, float]:
        now = time.time()
        counters = self.psutil.net_io_counters()
        if self.previous_net is None:
            self.previous_net = counters
            self.previous_net_time = now
            return 0.0, 0.0
        elapsed = max(0.001, now - self.previous_net_time)
        in_mbps = max(0.0, counters.bytes_recv - self.previous_net.bytes_recv) / elapsed / BYTES_PER_MEGABIT
        out_mbps = max(0.0, counters.bytes_sent - self.previous_net.bytes_sent) / elapsed / BYTES_PER_MEGABIT
        self.previous_net = counters
        self.previous_net_time = now
        return in_mbps, out_mbps

    def sample(self) -> Dict[str, float]:
        if self.previous_net is None:
            self._network_rates()
        cpu = float(self.psutil.cpu_percent(interval=min(1.0, self.interval_hint)))
        memory = self.psutil.virtual_memory()
        disk = self.psutil.disk_usage(self._disk_root())
        network_in, network_out = self._network_rates()
        return {
            "CPU_Percent": round(cpu, 1),
            "RAM_Percent": round(float(memory.percent), 1),
            "Network_In_Mbps": round(network_in, 3),
            "Network_Out_Mbps": round(network_out, 3),
            "Disk_Main_Used_GB": round(float(disk.used) / GB, 2),
            "Disk_Main_Total_GB": round(float(disk.total) / GB, 2),
        }


def extract_core_temp_celsius(data) -> Optional[float]:
    core_count = int(getattr(data, "uiCoreCnt", 0) or 0)
    cpu_count = int(getattr(data, "uiCPUCnt", 0) or 0)
    total_cores = max(1, min(256, core_count * max(1, cpu_count)))
    cores_per_cpu = max(1, core_count)
    values = []
    for index in range(total_cores):
        value = float(data.fTemp[index])
        if int(data.ucDeltaToTjMax):
            cpu_index = min(127, index // cores_per_cpu)
            tj_max = float(data.uiTjMax[cpu_index] or 0)
            if tj_max > 0:
                value = tj_max - value
        if int(data.ucFahrenheit):
            value = (value - 32.0) * 5.0 / 9.0
        if -40.0 <= value <= 130.0:
            values.append(value)
    if not values:
        return None
    return round(sum(values) / len(values), 1)


def read_core_temp_windows() -> Tuple[Optional[float], str]:
    if platform.system().lower() != "windows":
        return None, "Core Temp: skipped on non-Windows."

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenFileMappingW.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_wchar_p]
    kernel32.OpenFileMappingW.restype = ctypes.c_void_p
    kernel32.MapViewOfFile.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_size_t]
    kernel32.MapViewOfFile.restype = ctypes.c_void_p
    kernel32.UnmapViewOfFile.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]

    file_map_read = 0x0004
    mappings = [
        ("CoreTempMappingObjectEx", CoreTempSharedDataEx),
        ("Global\\CoreTempMappingObjectEx", CoreTempSharedDataEx),
        ("CoreTempMappingObject", CoreTempSharedData),
        ("Global\\CoreTempMappingObject", CoreTempSharedData),
    ]
    saw_mapping = False
    last_error = ""

    for name, struct_type in mappings:
        handle = kernel32.OpenFileMappingW(file_map_read, False, name)
        if not handle:
            continue
        saw_mapping = True
        view = None
        try:
            size = ctypes.sizeof(struct_type)
            view = kernel32.MapViewOfFile(handle, file_map_read, 0, 0, size)
            if not view:
                last_error = "MapViewOfFile failed with error %s" % ctypes.get_last_error()
                continue
            data = struct_type()
            ctypes.memmove(ctypes.byref(data), view, size)
            temp = extract_core_temp_celsius(data)
            if temp is not None:
                return temp, "Core Temp: available via %s." % name
            last_error = "shared memory did not contain a valid temperature"
        except Exception as exc:  # pragma: no cover - Windows-specific guard.
            last_error = str(exc)
        finally:
            if view:
                kernel32.UnmapViewOfFile(view)
            kernel32.CloseHandle(handle)

    if saw_mapping:
        return None, "Core Temp: read failed (%s)." % (last_error or "unknown error")
    return None, "Core Temp: not running or shared memory disabled."


def post_payload(url: str, payload: Dict[str, float]) -> str:
    body = json.dumps({"ts": int(time.time() * 1000), "payload": payload}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            text = response.read().decode("utf-8", errors="replace")
            return "HTTP %s %s" % (response.status, text[:160])
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError("HTTP %s %s" % (exc.code, text[:200])) from exc


def parse_args(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send local server health metrics to ROSA.")
    parser.add_argument("--once", action="store_true", help="send one sample and exit")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between samples; default 5")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="path to URL config text file")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv or sys.argv[1:])
    interval = max(1.0, float(args.interval or 5.0))
    try:
        import psutil  # type: ignore
    except ImportError:
        print("Missing dependency: psutil")
        print("Install without admin rights: python -m pip install --user psutil")
        return 2

    try:
        config_path, url = load_api_url(args.config)
    except Exception as exc:
        print("Config error: %s" % exc)
        return 2

    sampler = SystemSampler(psutil, interval)
    print("Config file: %s" % config_path)
    print("POST URL: %s" % url)

    while True:
        started = time.time()
        payload = sampler.sample()
        temp, temp_status = read_core_temp_windows()
        if temp is not None:
            payload["CPU_Temperature_C"] = temp
        print(temp_status)
        try:
            result = post_payload(url, payload)
            print("%s sent %s fields: %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), len(payload), result))
        except Exception as exc:
            print("%s send failed: %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), exc))
        if args.once:
            break
        time.sleep(max(0.0, interval - (time.time() - started)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
