// Vektor — install, repair, update and uninstall (for the current user, no administrator rights).
// A single executable: the app (vektor.html), the launcher (Vektor.exe) and the icon are embedded as resources.
//   Vektor-Setup.exe                 graphical interface (installs if missing, otherwise offers Repair / Update / Uninstall)
//                                    HTML window (setup.html in WebView2) in the colors of the theme chosen in the app; fallback: classic Windows window
//   Vektor-Setup.exe /uninstall      uninstall (used by “Installed apps”)
//   Vektor-Setup.exe /quiet          silent install (/launch: opens Vektor at the end);  /uninstall /quiet  silent uninstall
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Vektor — setup")]
[assembly: AssemblyDescription("Installs, repairs or uninstalls Vektor (image to SVG for GT7 decals)")]
[assembly: AssemblyProduct("Vektor")]
[assembly: AssemblyCompany("AltKlin")]
[assembly: AssemblyVersion("2.23.0.0")]
[assembly: AssemblyFileVersion("2.23.0.0")]

static class Setup
{
    public const string Version = "2.23.0";
    public const string RepoUrl = "https://github.com/AltKlin/Vektor";
    static readonly string LocalApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    public static readonly string Dir = Path.Combine(Path.Combine(LocalApp, "Programs"), "Vektor");
    public static readonly string ProfileDir = Path.Combine(LocalApp, "Vektor");
    const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Vektor";
    public static string DesktopLnk { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Vektor.lnk"); } }
    public static string StartLnk { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Vektor.lnk"); } }
    public static string ExePath { get { return Path.Combine(Dir, "Vektor.exe"); } }
    public static string SetupPath { get { return Path.Combine(Dir, "Vektor-Setup.exe"); } }
    static string Self { get { return Assembly.GetExecutingAssembly().Location; } }
    // setup log (useful if something goes wrong) and non-blocking warnings shown at the end
    public static string LogPath { get { return Path.Combine(ProfileDir, "setup.log"); } }
    public static readonly List<string> Warnings = new List<string>();
    static bool NoLog;
    public static void LogLine(string s)
    {
        if (NoLog) return;
        try { Directory.CreateDirectory(ProfileDir); File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + s + Environment.NewLine, Encoding.UTF8); } catch { }
    }
    static void Warn(Action<string> log, string s) { Warnings.Add(s); LogLine("WARNING: " + s); Say(log, s); }

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main(string[] args)
    {
        bool quiet = Has(args, "/quiet") || Has(args, "/q") || Has(args, "/silent");
        bool uninstall = Has(args, "/uninstall") || Has(args, "/u");
        if (quiet)
        {
            try { if (uninstall) Uninstall(null); else Install(InstalledVersion() == null || File.Exists(DesktopLnk), Has(args, "/launch"), null); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        // the WebView2 DLLs are embedded: loaded from the setup resources
        AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
        {
            string n = new AssemblyName(e.Name).Name + ".dll";
            using (Stream r = Assembly.GetExecutingAssembly().GetManifestResourceStream(n))
            {
                if (r == null) return null;
                byte[] b = new byte[r.Length]; int o = 0; while (o < b.Length) { int k = r.Read(b, o, b.Length - o); if (k <= 0) break; o += k; }
                return Assembly.Load(b);
            }
        };
        bool shown = false;
        try { shown = TryWeb(uninstall); } catch (Exception e) { LogLine("HTML window unavailable: " + e.Message); }
        if (!shown) Application.Run(new SetupForm(uninstall));
        return 0;
    }
    [MethodImpl(MethodImplOptions.NoInlining)] static bool TryWeb(bool uninstall) { return WebSetup.Run(uninstall); }

    // theme chosen in the app (saved by Vektor.exe): Garage, Blue grid and Red grid have their own setup version; otherwise Workshop
    public static string SetupTheme()
    {
        if (InstalledVersion() == null) return "workshop";
        string t = null;
        try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Vektor")) if (k != null) t = k.GetValue("Theme") as string; } catch { }
        if (string.IsNullOrEmpty(t)) return "workshop";
        if (t.StartsWith("x-garage")) return "garage";
        if (t == "x-grid blue") return "grid-blue";
        if (t == "x-grid") return "grid";
        return "workshop";
    }

    static bool Has(string[] a, string k) { foreach (string x in a) if (string.Equals(x, k, StringComparison.OrdinalIgnoreCase)) return true; return false; }

    /* ───── state ───── */
    public static string InstalledVersion()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstKey))
        {
            if (k != null) { string v = k.GetValue("DisplayVersion") as string; if (!string.IsNullOrEmpty(v)) return v; }
        }
        return File.Exists(ExePath) ? "?" : null;
    }
    public static bool IsNewer(string installed)
    {
        Version a, b;
        if (installed == null || !System.Version.TryParse(installed, out a)) return true;
        return System.Version.TryParse(Version, out b) && b > a;
    }

    /* ───── install / repair ───── */
    public static void Install(bool desktop, bool launch, Action<string> log)
    {
        Warnings.Clear();
        LogLine("--- Installing Vektor " + Version + " from " + Self);
        Say(log, "Closing Vektor if it is open…");
        CloseApp("Vektor");
        Directory.CreateDirectory(Dir);
        Say(log, "Copying files…");
        foreach (string f in new[] { "vektor.html", "vektor.ico", "Vektor.exe", "README.txt", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "runtimes/win-x64/native/WebView2Loader.dll", "runtimes/win-x86/native/WebView2Loader.dll", "runtimes/win-arm64/native/WebView2Loader.dll" }) Extract(f);
        if (!PathEq(Self, SetupPath)) File.Copy(Self, SetupPath, true);
        Say(log, "Shortcuts…");
        try { Shortcut(StartLnk); if (desktop) Shortcut(DesktopLnk); else TryDel(DesktopLnk); }
        catch (Exception e) { LogLine(e.ToString()); Warn(log, "Shortcuts not created: " + e.Message); }
        Say(log, "Registering in “Installed apps”…");
        Register();
        LogLine("Installed in " + Dir);
        if (launch) { try { Launch(); } catch (Exception e) { LogLine(e.ToString()); Warn(log, "Vektor is installed but could not open by itself: " + e.Message); } }
    }
    public static void Launch()
    {
        ProcessStartInfo p = new ProcessStartInfo(ExePath);
        p.UseShellExecute = true; p.WorkingDirectory = Dir;
        Process.Start(p);
    }
    static void Extract(string name)
    {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) throw new Exception("Resource missing from the installer: " + name);
            string dest = Path.Combine(Dir, name.Replace('/', '\\')); Directory.CreateDirectory(Path.GetDirectoryName(dest));
            for (int i = 0; ; i++)   // Vektor.exe may still be closing (update started from the app)
            {
                try { using (FileStream o = File.Create(dest)) s.CopyTo(o); break; }
                catch (IOException) { if (i >= 20) throw; Thread.Sleep(300); s.Position = 0; }
                catch (UnauthorizedAccessException) { if (i >= 20) throw; Thread.Sleep(300); s.Position = 0; }
            }
        }
    }
    static void Shortcut(string lnk)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(lnk));
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
        Type st = sc.GetType();
        st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { ExePath });
        st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Dir });
        st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { Path.Combine(Dir, "vektor.ico") + ",0" });
        st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Vektor — image to SVG for GT7 decals" });
        st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        Marshal.FinalReleaseComObject(sc); Marshal.FinalReleaseComObject(sh);
    }
    static void Register()
    {
        long size = 0;
        foreach (string f in Directory.GetFiles(Dir)) size += new FileInfo(f).Length;
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstKey))
        {
            k.SetValue("DisplayName", "Vektor");
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", "AltKlin");
            k.SetValue("DisplayIcon", Path.Combine(Dir, "vektor.ico"));
            k.SetValue("InstallLocation", Dir);
            k.SetValue("UninstallString", "\"" + SetupPath + "\" /uninstall");
            k.SetValue("QuietUninstallString", "\"" + SetupPath + "\" /uninstall /quiet");
            k.SetValue("ModifyPath", "\"" + SetupPath + "\"");
            k.SetValue("NoModify", 0, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
            k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            k.SetValue("URLInfoAbout", RepoUrl);
        }
        // vektor: protocol — the app's update bar opens it; the launcher downloads and installs the new version
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\vektor"))
        {
            k.SetValue("", "URL:Vektor");
            k.SetValue("URL Protocol", "");
            using (RegistryKey c = k.CreateSubKey(@"shell\open\command")) c.SetValue("", "\"" + ExePath + "\" \"%1\"");
            k.SetValue("HelpLink", RepoUrl);
        }
    }

    /* ───── uninstall ───── */
    public static void Uninstall(Action<string> log)
    {
        NoLog = true;   // the log is in the deleted folder: do not recreate it
        Say(log, "Closing Vektor if it is open…");
        CloseApp("Vektor");
        Say(log, "Removing shortcuts…");
        try { TryDel(DesktopLnk); TryDel(StartLnk); } catch { }
        Registry.CurrentUser.DeleteSubKeyTree(UninstKey, false);
        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\vektor", false); } catch { }
        Say(log, "Removing settings…");
        TryDelDir(ProfileDir);
        Say(log, "Removing files…");
        bool inside = PathEq(Path.GetDirectoryName(Self), Dir);
        if (Directory.Exists(Dir))
        {
            foreach (string f in Directory.GetFiles(Dir)) if (!PathEq(f, Self)) TryDel(f);
            if (inside) { try { DeleteLater(Dir); } catch { } } else TryDelDir(Dir);
        }
    }
    static void DeleteLater(string dir)
    {
        // the program cannot delete its own folder while running: a hidden cmd does it right after
        ProcessStartInfo p = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + dir + "\"");
        p.CreateNoWindow = true; p.UseShellExecute = false; p.WindowStyle = ProcessWindowStyle.Hidden;
        p.WorkingDirectory = Path.GetTempPath();
        Process.Start(p);
    }

    /* ───── utilities ───── */
    static void CloseApp(string profileName)
    {
        // closes the Edge/Chrome windows opened with the app's dedicated profile (and only those)
        string ps = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | " +
                    "Where-Object { $_.CommandLine -like '*\\" + profileName + "\\profile*' } | " +
                    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
        try
        {
            ProcessStartInfo p = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(ps)));
            p.CreateNoWindow = true; p.UseShellExecute = false; p.WindowStyle = ProcessWindowStyle.Hidden;
            using (Process pr = Process.Start(p)) { pr.WaitForExit(15000); }
            Thread.Sleep(500);
            // the app with its own engine (Vektor.exe + WebView2): closed too to free its files
            int me = Process.GetCurrentProcess().Id;
            foreach (Process v in Process.GetProcessesByName(profileName)) { try { if (v.Id == me) continue; if (!v.CloseMainWindow() || !v.WaitForExit(3000)) v.Kill(); v.WaitForExit(5000); } catch { } }
        }
        catch { }
    }
    static readonly char[] Slash = { '\\', '/' };   // TrimEnd(char[]): the TrimEnd(char) overload does not exist in .NET Framework
    static bool PathEq(string a, string b)
    {
        try { return string.Equals(Path.GetFullPath(a).TrimEnd(Slash), Path.GetFullPath(b).TrimEnd(Slash), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }
    static void TryDel(string f) { try { if (!string.IsNullOrEmpty(f) && File.Exists(f)) File.Delete(f); } catch { } }
    static void TryDelDir(string d) { for (int i = 0; i < 3; i++) { try { if (Directory.Exists(d)) Directory.Delete(d, true); return; } catch { Thread.Sleep(600); } } }
    static void Say(Action<string> log, string s) { LogLine(s); if (log != null) log(s); }
}

/* ───── HTML interface (WebView2) ───── */
static class WebSetup
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    static Form f; static WebView2 wv; static bool failed, busy;

    public static bool Run(bool uninstall)
    {
        string arch = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant() == "ARM64" || (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? "").ToUpperInvariant() == "ARM64" ? "arm64" : Environment.Is64BitProcess ? "x64" : "x86";
        string tmp = Path.Combine(Path.GetTempPath(), "Vektor-setup");
        string loader = Path.Combine(tmp, arch);
        Directory.CreateDirectory(loader);
        using (Stream r = Assembly.GetExecutingAssembly().GetManifestResourceStream("runtimes/win-" + arch + "/native/WebView2Loader.dll"))
        {
            if (r == null) return false;
            string dll = Path.Combine(loader, "WebView2Loader.dll");
            try { using (FileStream o = File.Create(dll)) r.CopyTo(o); } catch (IOException) { if (!File.Exists(dll)) throw; }   // already there (setup started again)
        }
        CoreWebView2Environment.SetLoaderDllFolderPath(loader);
        if (string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString())) return false;
        string html;
        using (Stream r = Assembly.GetExecutingAssembly().GetManifestResourceStream("setup.html"))
        {
            if (r == null) return false;
            using (StreamReader sr = new StreamReader(r, Encoding.UTF8)) html = sr.ReadToEnd();
        }
        string theme = Setup.SetupTheme(), ver = Setup.InstalledVersion();
        string state = "window.SETUP={version:" + J(Setup.Version) + ",installed:" + (ver == null ? "null" : J(ver)) + ",newer:" + (ver != null && Setup.IsNewer(ver) ? "true" : "false") +
            ",dir:" + J(Setup.Dir) + ",desktop:" + (File.Exists(Setup.DesktopLnk) ? "true" : "false") + ",theme:" + J(theme) + ",uninstall:" + (uninstall ? "true" : "false") + "};";
        Color bg = theme == "garage" ? Color.FromArgb(11, 18, 34) : theme == "grid-blue" ? Color.FromArgb(7, 12, 23) : theme == "grid" ? Color.FromArgb(11, 11, 12) : Color.FromArgb(19, 20, 22);

        f = new Form();
        f.Text = "Vektor — setup"; f.BackColor = bg;
        f.FormBorderStyle = FormBorderStyle.FixedSingle; f.MaximizeBox = false; f.MinimizeBox = true; f.StartPosition = FormStartPosition.CenterScreen;
        float k = 1f; using (Graphics g = f.CreateGraphics()) k = g.DpiX / 96f;
        f.ClientSize = new Size((int)(860 * k), (int)(560 * k));
        try { f.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
        f.HandleCreated += delegate { int on = 1; try { if (DwmSetWindowAttribute(f.Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(f.Handle, 19, ref on, 4); } catch { } };   // dark title bar
        wv = new WebView2(); wv.Dock = DockStyle.Fill; wv.DefaultBackgroundColor = bg;
        wv.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = Path.Combine(tmp, "webview2") };
        f.Controls.Add(wv);
        wv.CoreWebView2InitializationCompleted += async (s, e) =>
        {
            if (!e.IsSuccess) { Setup.LogLine("WebView2 : " + e.InitializationException); failed = true; f.Close(); return; }
            CoreWebView2 c = wv.CoreWebView2;
            c.Settings.AreDevToolsEnabled = false; c.Settings.IsStatusBarEnabled = false; c.Settings.AreDefaultContextMenusEnabled = false;
            c.Settings.IsZoomControlEnabled = false; c.Settings.IsPinchZoomEnabled = false; c.Settings.AreBrowserAcceleratorKeysEnabled = false;
            c.DocumentTitleChanged += delegate { if (!string.IsNullOrEmpty(c.DocumentTitle)) f.Text = c.DocumentTitle; };
            c.NewWindowRequested += (s2, e2) => { e2.Handled = true; };
            c.WebMessageReceived += (s2, e2) => { string m = null; try { m = e2.TryGetWebMessageAsString(); } catch { } if (m != null) OnMessage(m); };
            await c.AddScriptToExecuteOnDocumentCreatedAsync(state);
            c.NavigateToString(html);
        };
        f.FormClosing += (s, e) => { if (busy) e.Cancel = true; };   // no closing during installation
        f.Shown += async delegate { try { await wv.EnsureCoreWebView2Async(); } catch (Exception ex) { Setup.LogLine("WebView2 : " + ex); failed = true; f.Close(); } };
        Application.Run(f);
        try { wv.Dispose(); } catch { }
        return !failed;
    }

    static void OnMessage(string m)
    {
        string[] p = m.Split('|');
        switch (p[0])
        {
            case "close": f.Close(); break;
            case "launch":
                try { Setup.Launch(); f.Close(); } catch (Exception e) { Send("{\"t\":\"done\",\"ok\":false,\"error\":" + J(e.Message) + ",\"log\":" + J(Setup.LogPath) + "}"); }
                break;
            case "install": case "repair":
                bool desk = p.Length > 1 && p[1] == "1";
                Work(delegate { Setup.Install(desk, false, Log); });   // Vektor opens on the “Finish” click, not before
                break;
            case "uninstall":
                Work(delegate { Setup.Uninstall(Log); });
                break;
        }
    }
    static void Work(Action a)
    {
        busy = true;
        Thread t = new Thread(delegate ()
        {
            string err = null;
            try { a(); } catch (Exception e) { Setup.LogLine("ERROR: " + e); err = e.Message; }
            string w = "["; for (int i = 0; i < Setup.Warnings.Count; i++) w += (i > 0 ? "," : "") + J(Setup.Warnings[i]); w += "]";
            Send(err == null ? "{\"t\":\"done\",\"ok\":true,\"warnings\":" + w + ",\"log\":" + J(Setup.LogPath) + "}" : "{\"t\":\"done\",\"ok\":false,\"error\":" + J(err) + ",\"log\":" + J(Setup.LogPath) + "}");
            busy = false;
        });
        t.IsBackground = true; t.SetApartmentState(ApartmentState.STA); t.Start();
    }
    static void Log(string s) { Send("{\"t\":\"log\",\"s\":" + J(s) + "}"); }
    static void Send(string json)
    {
        if (f.InvokeRequired) { f.BeginInvoke(new Action<string>(Send), json); return; }
        try { wv.CoreWebView2.ExecuteScriptAsync("window.onHost&&window.onHost(" + json + ")"); } catch { }
    }
    static string J(string s)
    {
        StringBuilder b = new StringBuilder("\"");
        foreach (char ch in s ?? "")
        {
            if (ch == '"' || ch == '\\') b.Append('\\').Append(ch);
            else if (ch < 0x20 || ch == '\u2028' || ch == '\u2029' || ch == '<') b.Append("\\u").Append(((int)ch).ToString("x4"));
            else b.Append(ch);
        }
        return b.Append('"').ToString();
    }
}

/* ───── classic interface (if WebView2 is missing) ───── */
sealed class SetupForm : Form
{
    readonly Label status = new Label();
    readonly CheckBox cbDesk = new CheckBox(), cbLaunch = new CheckBox();
    readonly FlowLayoutPanel buttons = new FlowLayoutPanel();
    static readonly Color Ink = Color.FromArgb(20, 21, 23), Accent = Color.FromArgb(255, 106, 26), Mute = Color.FromArgb(163, 160, 154);

    public SetupForm(bool uninstallAtStart)
    {
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Vektor — setup";
        Font = new Font("Segoe UI", 10F);
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(660, 390);
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

        Panel banner = new Panel(); banner.Dock = DockStyle.Top; banner.Height = 92; banner.BackColor = Ink;
        PictureBox pic = new PictureBox(); pic.SizeMode = PictureBoxSizeMode.Zoom; pic.SetBounds(24, 20, 52, 52);
        try { pic.Image = new Icon(Icon, 64, 64).ToBitmap(); } catch { }
        Label title = new Label(); title.Text = "Vektor"; title.ForeColor = Color.White; title.AutoSize = true; title.Location = new Point(90, 14);
        title.Font = new Font(FontFamilyOr("Bahnschrift", "Segoe UI Semibold"), 22F, FontStyle.Bold);
        Label sub = new Label(); sub.Text = "Image → SVG for Gran Turismo 7 decals  ·  version " + Setup.Version; sub.ForeColor = Mute; sub.AutoSize = true; sub.Location = new Point(93, 56);
        banner.Controls.AddRange(new Control[] { pic, title, sub });
        Panel strip = new Panel(); strip.Dock = DockStyle.Top; strip.Height = 3; strip.BackColor = Accent;

        status.SetBounds(26, 112, 610, 128); status.ForeColor = Ink;
        cbDesk.Text = "Create a desktop shortcut"; cbDesk.AutoSize = true; cbDesk.Location = new Point(28, 246); cbDesk.Checked = true;
        cbLaunch.Text = "Open Vektor when done"; cbLaunch.AutoSize = true; cbLaunch.Location = new Point(28, 274); cbLaunch.Checked = true;

        buttons.Dock = DockStyle.Bottom; buttons.AutoSize = true; buttons.AutoSizeMode = AutoSizeMode.GrowAndShrink; buttons.WrapContents = false; buttons.FlowDirection = FlowDirection.RightToLeft;
        buttons.Padding = new Padding(16, 12, 16, 12); buttons.BackColor = Color.FromArgb(246, 245, 242);

        Controls.AddRange(new Control[] { status, cbDesk, cbLaunch, buttons, strip, banner });
        ShowState();
        if (uninstallAtStart) Shown += delegate { AskUninstall(); };
    }

    static string FontFamilyOr(string a, string b) { foreach (FontFamily f in FontFamily.Families) if (f.Name == a) return a; return b; }

    Button Btn(string text, bool primary, EventHandler click)
    {
        Button b = new Button(); b.Text = text; b.AutoSize = true; b.MinimumSize = new Size(96, 34); b.Margin = new Padding(8, 0, 0, 0);
        b.Padding = new Padding(10, 0, 10, 0); b.Cursor = Cursors.Hand;
        if (primary) { b.FlatStyle = FlatStyle.Flat; b.BackColor = Accent; b.ForeColor = Color.FromArgb(26, 13, 5); b.FlatAppearance.BorderSize = 0; b.Font = new Font(Font, FontStyle.Bold); }
        b.Click += click; buttons.Controls.Add(b); return b;
    }

    void ShowState()
    {
        buttons.Controls.Clear();
        string ver = Setup.InstalledVersion();
        if (ver == null)
        {
            Text = "Install Vektor";
            status.Text = "Vektor is not installed on this PC yet.\n\nIt will be installed for your Windows account only, without administrator rights, in:\n" + Setup.Dir;
            cbDesk.Visible = true; cbDesk.Checked = true; cbLaunch.Visible = true;
            AcceptButton = Btn("Install", true, delegate { Run(false); });
            CancelButton = Btn("Cancel", false, delegate { Close(); });
        }
        else
        {
            bool newer = Setup.IsNewer(ver);
            Text = "Vektor — " + (newer ? "update" : "repair or uninstall");
            status.Text = "Vektor " + (ver == "?" ? "" : ver + " ") + "is installed in:\n" + Setup.Dir + "\n\n" +
                (newer ? "This program contains version " + Setup.Version + ". “Update” replaces the old one and keeps your settings."
                       : "What do you want to do? “Repair” reinstalls the files and shortcuts without touching your settings.");
            cbDesk.Visible = true; cbDesk.Checked = File.Exists(Setup.DesktopLnk); cbLaunch.Visible = false;
            CancelButton = Btn("Close", false, delegate { Close(); });
            Btn("Uninstall", false, delegate { AskUninstall(); });
            Btn("Open Vektor", false, delegate { try { Setup.Launch(); Close(); } catch (Exception e) { Error(e); } });
            AcceptButton = Btn(newer ? "Update" : "Repair", true, delegate { Run(true); });
        }
    }

    void Busy(bool on) { foreach (Control c in buttons.Controls) c.Enabled = !on; cbDesk.Enabled = cbLaunch.Enabled = !on; UseWaitCursor = on; }
    void Log(string s) { if (InvokeRequired) BeginInvoke(new Action<string>(Log), s); else status.Text = s; }

    void Run(bool repair)
    {
        bool desk = cbDesk.Checked, launch = !repair && cbLaunch.Checked;
        Busy(true);
        Thread t = new Thread(delegate ()
        {
            Exception err = null;
            try { Setup.Install(desk, launch, Log); } catch (Exception e) { err = e; }
            BeginInvoke(new Action(delegate
            {
                Busy(false);
                if (err != null) { Error(err); ShowState(); return; }
                buttons.Controls.Clear(); cbDesk.Visible = cbLaunch.Visible = false;
                Text = "Vektor is ready";
                status.Text = (repair ? "Vektor " + Setup.Version + " has been repaired." : "Vektor " + Setup.Version + " is installed.") +
                    "\n\nYou will find it in the Start menu" + (desk ? " and on the desktop" : "") + ".\nTo repair or uninstall it later: Settings → Apps → Vektor, or run this program again." +
                    (Setup.Warnings.Count > 0 ? "\n\nNote:\n• " + string.Join("\n• ", Setup.Warnings.ToArray()) + "\n(details: " + Setup.LogPath + ")" : "");
                AcceptButton = Btn("Finish", true, delegate { Close(); });
                if (!launch) Btn("Open Vektor", false, delegate { try { Setup.Launch(); Close(); } catch (Exception e) { Error(e); } });
            }));
        });
        t.IsBackground = true; t.SetApartmentState(ApartmentState.STA); t.Start();
    }

    void AskUninstall()
    {
        if (Setup.InstalledVersion() == null) { MessageBox.Show(this, "Vektor is not installed.", "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Information); ShowState(); return; }
        if (MessageBox.Show(this, "Uninstall Vektor?\n\nThe app, its shortcuts and its settings will be removed. Your exported SVG files are not touched.",
            "Uninstall Vektor", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        Busy(true);
        Thread t = new Thread(delegate ()
        {
            Exception err = null;
            try { Setup.Uninstall(Log); } catch (Exception e) { err = e; }
            BeginInvoke(new Action(delegate
            {
                Busy(false);
                if (err != null) { Error(err); ShowState(); return; }
                buttons.Controls.Clear(); cbDesk.Visible = cbLaunch.Visible = false;
                Text = "Vektor is uninstalled";
                status.Text = "Vektor has been uninstalled.\n\nYour exported SVGs stay where you saved them.";
                AcceptButton = Btn("Finish", true, delegate { Close(); });
            }));
        });
        t.IsBackground = true; t.SetApartmentState(ApartmentState.STA); t.Start();
    }

    void Error(Exception e)
    {
        Setup.LogLine("ERROR: " + e);
        MessageBox.Show(this, "An error occurred:\n\n" + e.Message + "\n\nDetails: " + Setup.LogPath, "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
