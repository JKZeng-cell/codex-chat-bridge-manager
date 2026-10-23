using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
[assembly: AssemblyProduct("Codex Chat Bridge Manager")]
[assembly: AssemblyFileVersion("1.0.4.0")]
[assembly: AssemblyInformationalVersion("1.0.4")]
public class InstallerTrayProbe {
  private static string folder;
  private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  private static readonly WindowProcedure callback = Procedure;
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct WindowClass {
    public uint style; public WindowProcedure procedure; public int extraClass, extraWindow;
    public IntPtr instance, icon, cursor, background; public string menu, name;
  }
  [StructLayout(LayoutKind.Sequential)] private struct Message {
    public IntPtr window; public uint message; public UIntPtr wparam; public IntPtr lparam;
    public uint time; public int x, y; public uint extra;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern ushort RegisterClass(ref WindowClass windowClass);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr CreateWindowEx(uint extended, string name, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint first, uint last);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern void PostQuitMessage(int code);
  [DllImport("user32.dll")] private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint timeout, IntPtr callback);
  private static IntPtr Procedure(IntPtr window, uint message, IntPtr wparam, IntPtr lparam) {
    if (message == 0x0010) { File.WriteAllText(Path.Combine(folder,"hidden"),"WM_CLOSE only hides a tray app"); return IntPtr.Zero; }
    if (message == 0x0113 && File.Exists(Path.Combine(folder,"quit-requested"))) {
      if (File.Exists(Path.Combine(folder,"busy"))) { File.WriteAllText(Path.Combine(folder,"blocked"),"job protected"); return IntPtr.Zero; }
      File.WriteAllText(Path.Combine(folder,"closed"),"protected quit IPC"); DestroyWindow(window); PostQuitMessage(0); return IntPtr.Zero;
    }
    return DefWindowProc(window,message,wparam,lparam);
  }
  public static void Main(string[] args) {
    folder=AppDomain.CurrentDomain.BaseDirectory;
    if (Array.IndexOf(args,"--quit-for-update")>=0) { File.WriteAllText(Path.Combine(folder,"quit-requested"),"requested"); return; }
    var wc=new WindowClass { procedure=callback, instance=GetModuleHandle(null), name="Chrome_WidgetWin_1" };
    RegisterClass(ref wc);
    var window=CreateWindowEx(0x80,wc.name,"Bridge tray probe",0x00cf0000,-32000,-32000,100,100,IntPtr.Zero,IntPtr.Zero,wc.instance,IntPtr.Zero);
    SetTimer(window,new UIntPtr(1),50,IntPtr.Zero);
    File.WriteAllText(Path.Combine(folder,"ready"),"ready");
    Message msg;
    while(GetMessage(out msg,IntPtr.Zero,0,0)>0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
  }
}
