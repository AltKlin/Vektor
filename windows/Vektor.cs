// Vektor — Windows app: Vektor window with its own engine (WebView2, built into Windows 10/11), not an Edge window.
// If the WebView2 component is missing, fallback: Edge/Chrome in app mode.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Threading;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Vektor")]
[assembly: AssemblyProduct("Vektor — image to SVG for GT7")]
[assembly: AssemblyVersion("2.23.0.0")]

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0].StartsWith("vektor:", StringComparison.OrdinalIgnoreCase)) { Updater.Run(); return; }
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string html = Path.Combine(dir, "vektor.html");
        if (!File.Exists(html))
        {
            MessageBox.Show("File not found:\n" + html + "\n\nRun Vektor-Setup.exe again and choose “Repair”.", "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string url = new Uri(html).AbsoluteUri;
        if (RuntimeOk(dir)) { try { AppWindow.Run(dir, url); return; } catch (Exception e) { Log(e.ToString()); } }
        OpenInBrowser(url);
    }

    // WebView2 component present and loader in the right format (x64, x86 or ARM64)?
    static bool RuntimeOk(string dir)
    {
        try
        {
            string arch = Env("PROCESSOR_ARCHITECTURE").ToUpperInvariant() == "ARM64" || Env("PROCESSOR_ARCHITEW6432").ToUpperInvariant() == "ARM64" ? "arm64" : Environment.Is64BitProcess ? "x64" : "x86";
            string loader = Path.Combine(dir, "runtimes\\win-" + arch + "\\native");
            if (File.Exists(Path.Combine(loader, "WebView2Loader.dll"))) CoreWebView2Environment.SetLoaderDllFolderPath(loader);
            return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch (Exception e) { Log(e.ToString()); return false; }
    }

    public static void Log(string s)
    {
        try { string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vektor"); Directory.CreateDirectory(d); File.AppendAllText(Path.Combine(d, "vektor.log"), DateTime.Now.ToString("s") + " " + s + "\r\n"); } catch { }
    }

    static void OpenInBrowser(string url)
    {
        string browser = FindBrowser();
        if (browser == null) { Process.Start(url); return; }
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vektor\\profile");
        string argline = "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --window-size=1480,940 --no-first-run --no-default-browser-check --disable-sync";
        ProcessStartInfo psi = new ProcessStartInfo(browser, argline);
        psi.UseShellExecute = false;
        try { Process.Start(psi); }
        catch (Exception e) { MessageBox.Show("Could not start " + browser + "\n" + e.Message, "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    static string Env(string name)
    {
        string v = Environment.GetEnvironmentVariable(name);
        return v == null ? "" : v;
    }

    static string FindBrowser()
    {
        string[] candidates = new string[] {
            Env("ProgramFiles(x86)") + @"\Microsoft\Edge\Application\msedge.exe",
            Env("ProgramFiles") + @"\Microsoft\Edge\Application\msedge.exe",
            Env("LOCALAPPDATA") + @"\Microsoft\Edge\Application\msedge.exe",
            Env("ProgramFiles") + @"\Google\Chrome\Application\chrome.exe",
            Env("ProgramFiles(x86)") + @"\Google\Chrome\Application\chrome.exe",
            Env("LOCALAPPDATA") + @"\Google\Chrome\Application\chrome.exe"
        };
        foreach (string c in candidates) if (c.Length > 20 && File.Exists(c)) return c;
        foreach (string exe in new string[] { "msedge.exe", "chrome.exe" })
        {
            foreach (RegistryKey root in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe);
                if (k == null) continue;
                string v = k.GetValue("") as string;
                if (v != null && File.Exists(v)) return v;
            }
        }
        return null;
    }
}

// App window: full-frame WebView2, size and position remembered, downloads saved directly
static class AppWindow
{
    public static void Run(string dir, string url)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vektor\\webview2");
        Form f = new Form();
        f.Text = "Vektor"; f.BackColor = Color.FromArgb(24, 24, 27); f.StartPosition = FormStartPosition.CenterScreen;
        f.MinimumSize = new Size(900, 600);
        Rectangle wa = Screen.PrimaryScreen.WorkingArea;
        f.Size = new Size(Math.Min(1480, wa.Width), Math.Min(940, wa.Height));
        try { f.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
        RestoreBounds(f);
        WebView2 wv = new WebView2();
        wv.Dock = DockStyle.Fill; wv.DefaultBackgroundColor = Color.FromArgb(24, 24, 27);
        wv.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = data, AdditionalBrowserArguments = "--allow-file-access-from-files" };
        f.Controls.Add(wv);
        wv.CoreWebView2InitializationCompleted += (s, e) =>
        {
            if (!e.IsSuccess) { Program.Log("init " + e.InitializationException); MessageBox.Show(f, "The WebView2 engine did not start:\n" + e.InitializationException.Message, "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Error); f.Close(); return; }
            CoreWebView2 c = wv.CoreWebView2;
            c.Settings.AreDevToolsEnabled = false; c.Settings.IsStatusBarEnabled = false; c.Settings.AreBrowserAcceleratorKeysEnabled = false;
            c.Settings.IsZoomControlEnabled = false; c.Settings.IsPinchZoomEnabled = false;
            c.DocumentTitleChanged += (s2, e2) => { string t = c.DocumentTitle; f.Text = string.IsNullOrEmpty(t) ? "Vektor" : t; };
            // external links (GitHub, gran-turismo.com…): default browser; popup windows: same
            c.NewWindowRequested += (s2, e2) => { e2.Handled = true; OpenExternal(e2.Uri); };
            // theme chosen in the app: remembered so the installer (update, repair) uses the same colors
            c.WebMessageReceived += (s2, e2) =>
            {
                string m = null; try { m = e2.TryGetWebMessageAsString(); } catch { }
                if (m == null || !m.StartsWith("theme:") || m.Length > 80) return;
                try { using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Key)) k.SetValue("Theme", m.Substring(6)); } catch { }
            };
            c.NavigationStarting += (s2, e2) => { if (!e2.Uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase) && !e2.Uri.StartsWith("about:") && !e2.Uri.StartsWith("blob:") && !e2.Uri.StartsWith("data:")) { e2.Cancel = true; OpenExternal(e2.Uri); } };
            c.ProcessFailed += (s2, e2) => { Program.Log("process failed " + e2.ProcessFailedKind); if (e2.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited || e2.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited) { try { c.Reload(); } catch { } } };
            c.Navigate(url);
        };
        f.FormClosing += (s, e) => SaveBounds(f);
        f.Shown += async (s, e) => { try { await wv.EnsureCoreWebView2Async(); } catch (Exception ex) { Program.Log(ex.ToString()); } };
        Application.Run(f);
    }

    static void OpenExternal(string u)
    {
        try
        {
            if (u.StartsWith("vektor:", StringComparison.OrdinalIgnoreCase)) Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, u) { UseShellExecute = false });   // one-click update
            else if (u.StartsWith("http", StringComparison.OrdinalIgnoreCase) || u.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)) Process.Start(new ProcessStartInfo(u) { UseShellExecute = true });
        }
        catch (Exception e) { Program.Log(e.ToString()); }
    }

    const string Key = @"Software\Vektor";
    static void RestoreBounds(Form f)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Key))
            {
                if (k == null) return; string v = k.GetValue("Window") as string; if (v == null) return;
                string[] p = v.Split(','); if (p.Length < 5) return;
                Rectangle r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                foreach (Screen sc in Screen.AllScreens) if (sc.WorkingArea.IntersectsWith(r)) { f.StartPosition = FormStartPosition.Manual; f.Bounds = r; break; }
                if (p[4] == "1") f.WindowState = FormWindowState.Maximized;
            }
        }
        catch { }
    }
    static void SaveBounds(Form f)
    {
        try
        {
            Rectangle r = f.WindowState == FormWindowState.Normal ? f.Bounds : f.RestoreBounds;
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Key)) k.SetValue("Window", r.X + "," + r.Y + "," + r.Width + "," + r.Height + "," + (f.WindowState == FormWindowState.Maximized ? "1" : "0"));
        }
        catch { }
    }
}

// One-click update: downloads the latest Vektor-Setup.exe from the GitHub release, runs it silently
// (it closes the app, replaces the files and reopens Vektor), then exits to free Vektor.exe.
static class Updater
{
    const string Url = "https://github.com/AltKlin/Vektor/releases/latest/download/Vektor-Setup.exe";

    public static void Run()
    {
        Application.EnableVisualStyles();
        Form f = new Form();
        f.Text = "Updating Vektor"; f.FormBorderStyle = FormBorderStyle.FixedDialog; f.MaximizeBox = false; f.MinimizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen; f.ClientSize = new Size(420, 120); f.Font = new Font("Segoe UI", 10F); f.TopMost = true;
        try { f.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
        Label l = new Label(); l.SetBounds(20, 18, 380, 24); l.Text = "Downloading the new version…";
        ProgressBar bar = new ProgressBar(); bar.SetBounds(20, 52, 380, 18);
        f.Controls.Add(l); f.Controls.Add(bar);
        string dest = Path.Combine(Path.GetTempPath(), "Vektor-Setup-maj.exe");
        f.Shown += delegate
        {
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }   // TLS 1.2 for github.com
            WebClient wc = new WebClient();
            wc.Headers.Add("User-Agent", "Vektor-updater");
            wc.DownloadProgressChanged += (s, e) => { bar.Value = Math.Max(0, Math.Min(100, e.ProgressPercentage)); };
            wc.DownloadFileCompleted += (s, e) =>
            {
                if (e.Error != null)
                {
                    MessageBox.Show(f, "Download failed:\n" + e.Error.Message + "\n\nDownload Vektor-Setup.exe from the Releases page of the AltKlin/Vektor project on GitHub.", "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    f.Close(); return;
                }
                l.Text = "Installing…"; bar.Style = ProgressBarStyle.Marquee;
                try
                {
                    ProcessStartInfo p = new ProcessStartInfo(dest, "/quiet /launch");
                    p.UseShellExecute = false; p.WorkingDirectory = Path.GetTempPath();
                    Process.Start(p);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(f, "Could not start the update:\n" + ex.Message, "Vektor", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                f.Close();   // Vektor.exe must be free so the installer can replace it
            };
            wc.DownloadFileAsync(new Uri(Url), dest);
        };
        Application.Run(f);
    }
}

