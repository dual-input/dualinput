// A tray icon and nothing else, through Shell_NotifyIconW called directly, so
// it publishes with Native AOT, which WinForms doesn't support. For p01; prints
// TRAY once the icon is in place.

using System;
using System.Runtime.InteropServices;

static unsafe class Program
{
    [StructLayout(LayoutKind.Sequential)]
    struct NOTIFYICONDATAW
    {
        public uint cbSize; public nint hWnd; public uint uID; public uint uFlags; public uint uCallbackMessage; public nint hIcon;
        public fixed char szTip[128]; public uint dwState; public uint dwStateMask; public fixed char szInfo[256];
        public uint uVersion; public fixed char szInfoTitle[64]; public uint dwInfoFlags; public Guid guidItem; public nint hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public nint hwnd; public uint message; public nint wParam; public nint lParam; public uint time; public int x; public int y; public uint lPrivate; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern nint CreateWindowExW(uint ex, string cls, string name, uint style, int x, int y, int w, int h, nint parent, nint menu, nint inst, nint param);
    [DllImport("user32.dll")] static extern nint LoadIconW(nint inst, nint name);
    [DllImport("user32.dll")] static extern int GetMessageW(MSG* msg, nint hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern nint DispatchMessageW(MSG* msg);
    [DllImport("shell32.dll")] static extern int Shell_NotifyIconW(uint message, NOTIFYICONDATAW* data);

    static int Main()
    {
        // The predefined STATIC class needs no registration; the icon needs a window to belong to.
        var hwnd = CreateWindowExW(0, "STATIC", "p01", 0, 0, 0, 0, 0, 0, 0, 0, 0);
        var data = new NOTIFYICONDATAW { cbSize = (uint)sizeof(NOTIFYICONDATAW), hWnd = hwnd, uID = 1, uFlags = 0x2 | 0x4, hIcon = LoadIconW(0, 32512) };
        var tip = "p01 tray: .NET Native AOT";
        for (int i = 0; i < tip.Length; i++) data.szTip[i] = tip[i];
        if (Shell_NotifyIconW(0, &data) == 0) { Console.Out.WriteLine("ERROR Shell_NotifyIconW"); return 1; }
        Console.Out.WriteLine("TRAY");
        Console.Out.Flush();
        MSG msg;
        while (GetMessageW(&msg, 0, 0, 0) > 0) DispatchMessageW(&msg);
        return 0;
    }
}
