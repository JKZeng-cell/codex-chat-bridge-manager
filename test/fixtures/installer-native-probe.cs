using System;
using System.IO;
using System.Runtime.InteropServices;
public class InstallerNativeProbe {
  private static string folder;
  private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  private static readonly WindowProcedure callback = Procedure;
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct WindowClass {
    public uint style; public WindowProcedure procedure; public int extraClass, extraWindow;
    public IntPtr instance, icon, cursor, background;
    public string menu, name;
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
  private static IntPtr Procedure(IntPtr window, uint message, IntPtr wparam, IntPtr lparam) {
    if (message == 0x0010) {
      if (File.Exists(Path.Combine(folder,"busy"))) { File.WriteAllText(Path.Combine(folder,"blocked"),"busy job protected"); return IntPtr.Zero; }
      File.WriteAllText(Path.Combine(folder,"closed"),"normal close"); DestroyWindow(window); return IntPtr.Zero;
    }
    if (message == 0x0002) { PostQuitMessage(0); return IntPtr.Zero; }
    return DefWindowProc(window,message,wparam,lparam);
  }
  public static void Main(string[] args) {
    folder=args[0]; var module=GetModuleHandle(null);
    var definition=new WindowClass { procedure=callback, instance=module, name="Chrome_WidgetWin_1" };
    if(RegisterClass(ref definition)==0) throw new Exception("Window class registration failed");
    var window=CreateWindowEx(0x80,definition.name,"Isolated installer shutdown probe",0x00cf0000,-32000,-32000,360,240,IntPtr.Zero,IntPtr.Zero,module,IntPtr.Zero);
    if(window==IntPtr.Zero) throw new Exception("Probe window creation failed");
    File.WriteAllText(Path.Combine(folder,"ready"),"ready");
    Message message; while(GetMessage(out message,IntPtr.Zero,0,0)>0) { TranslateMessage(ref message); DispatchMessage(ref message); }
  }
}
