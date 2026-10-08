// A tray icon and nothing else, through WinForms' NotifyIcon, for p01. Prints
// TRAY once the icon is in place.

using System;
using System.Drawing;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        var icon = new NotifyIcon { Icon = SystemIcons.Application, Text = "p01 tray: WinForms", Visible = true };
        Console.Out.WriteLine("TRAY");
        Console.Out.Flush();
        Application.Run();
        GC.KeepAlive(icon);
    }
}
