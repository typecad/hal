using System;
using System.Runtime.InteropServices;

class RawListen {
  [DllImport("user32.dll")] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);
  [DllImport("user32.dll")] static extern ushort RegisterClassW(ref WNDCLASSW wc);
  [DllImport("user32.dll")] static extern IntPtr CreateWindowExW(uint ex, ushort cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] static extern int GetMessageW(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern IntPtr DefWindowProcW(IntPtr h, uint m, IntPtr w, IntPtr l, IntPtr a, IntPtr b);

  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort usUsagePage, usUsage, dwFlags; public IntPtr hwndTarget; }
  [StructLayout(LayoutKind.Sequential)] struct WNDCLASSW { public uint style; public IntPtr lpfnWndProc; public int cbClsExtra, cbWndExtra; public IntPtr hInstance, hIcon, hCursor, hbrBackground; [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName; [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int ptX, ptY; }
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public IntPtr hDevice; public uint dwType, dwSize; public IntPtr wParam; }

  static IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l, IntPtr a, IntPtr b) {
    if (m == 0x00FF) { // WM_INPUT
      uint size = 0;
      GetRawInputData(l, 0x10000003, IntPtr.Zero, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>());
      IntPtr buf = Marshal.AllocHGlobal((int)size);
      GetRawInputData(l, 0x10000003, buf, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>());
      var hdr = Marshal.PtrToStructure<RAWINPUTHEADER>(buf);
      // print only our VID (device handle low bits vary — print all, short)
      byte[] b2 = new byte[Math.Min(size, 24)];
      Marshal.Copy(buf, b2, 0, b2.Length);
      int hidLen = BitConverter.ToInt32(b2, 16);
      string hex = BitConverter.ToString(b2, 20, Math.Min(hidLen, 12)).Replace("-", " ");
      Console.WriteLine("WM_INPUT dev=" + hdr.hDevice + " type=" + hdr.dwType + " len=" + hidLen + " bytes=" + hex);
      Marshal.FreeHGlobal(buf);
    }
    return DefWindowProcW(h, m, w, l, a, b);
  }

  static void Main() {
    var wc = new WNDCLASSW { lpfnWndProc = Marshal.GetFunctionPointerForDelegate((WndProcDelegate)WndProc), lpszClassName = "RL" };
    ushort cls = RegisterClassW(ref wc);
    IntPtr hwnd = CreateWindowExW(0, cls, "", 0, 0, 0, 0, 0, (IntPtr)(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    var rid = new RAWINPUTDEVICE[1];
    rid[0].usUsagePage = 1; rid[0].usUsage = 2; rid[0].dwFlags = 0x00000100 /*RIDEV_INPUTSINK*/; rid[0].hwndTarget = hwnd;
    // also keyboard: usage 6
    var rid2 = new RAWINPUTDEVICE[2];
    rid2[0] = rid[0];
    rid2[1].usUsagePage = 1; rid2[1].usUsage = 6; rid2[1].dwFlags = 0x100; rid2[1].hwndTarget = hwnd;
    if (!RegisterRawInputDevices(rid2, 2, (uint)Marshal.SizeOf<RAWINPUTDEVICE>())) { Console.WriteLine("register failed " + Marshal.GetLastWin32Error()); return; }
    Console.WriteLine("listening...");
    var sw = System.Diagnostics.Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < 8000) { MSG m; GetMessageW(out m, IntPtr.Zero, 0, 0); }
  }
  delegate IntPtr WndProcDelegate(IntPtr h, uint m, IntPtr w, IntPtr l, IntPtr a, IntPtr b);
}
