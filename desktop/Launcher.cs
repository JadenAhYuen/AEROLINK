using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.IO.Compression;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Aerolink {
  public class Launcher : Form {
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private Process gateway, dashboard;
    private bool busy;
    private bool smokeTest;
    private const string CurrentVersion = "0.5.1";
    private string updateVersion, updateZipUrl, updateHashUrl;
    private string address;
    private Label status, detail;
    private Button open, retry, stop, update;
    private readonly Timer monitor = new Timer { Interval = 2500 };

    [STAThread]
    public static void Main(string[] args) {
      var waitArg = args.FirstOrDefault(a => a.StartsWith("--wait-for="));
      if (waitArg != null) {
        int oldPid;
        if (Int32.TryParse(waitArg.Substring(11), out oldPid)) {
          try { Process.GetProcessById(oldPid).WaitForExit(20000); } catch (ArgumentException) { }
        }
      }
      bool created;
      using (var mutex = new System.Threading.Mutex(true, "Local\\AerolinkLauncher", out created)) {
        if (!created) { MessageBox.Show("AEROLINK is already open. Use the existing launcher window.", "AEROLINK"); return; }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Contains("--self-test")) {
          var result = new Launcher();
          try { result.CheckFiles(); File.WriteAllText(Path.Combine(result.root, "launcher-self-test.txt"), "PASS: launcher dependencies available"); }
          catch (Exception error) { File.WriteAllText(Path.Combine(result.root, "launcher-self-test.txt"), "FAIL: " + error.Message); Environment.ExitCode = 1; }
          result.Dispose(); return;
        }
        var launcher = new Launcher();
        launcher.smokeTest = args.Contains("--smoke-test");
        if (launcher.smokeTest) { launcher.Opacity = 0; launcher.ShowInTaskbar = false; }
        Application.Run(launcher);
      }
    }

    public Launcher() {
      Text = "AEROLINK"; ClientSize = new Size(520, 350);
      FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
      StartPosition = FormStartPosition.CenterScreen;
      BackColor = Color.FromArgb(245, 248, 252); Font = new Font("Segoe UI", 10);
      Controls.Add(new Label { Text = "AEROLINK", Location = new Point(28, 22), Size = new Size(450, 38), Font = new Font("Segoe UI", 23, FontStyle.Bold) });
      status = new Label { Text = "Starting your flight viewer...", Location = new Point(30, 78), Size = new Size(450, 27), Font = new Font("Segoe UI", 12, FontStyle.Bold) };
      detail = new Label { Location = new Point(30, 114), Size = new Size(450, 92), Text = "Please keep this window open while using the viewer." };
      open = Button("Open viewer", 30, delegate { OpenViewer(); });
      retry = Button("Retry", 192, async delegate { await StartServices(); });
      stop = Button("Stop", 354, delegate { StopServices(); status.Text = "Viewer stopped"; detail.Text = "Choose Retry to start again."; });
      update = new Button { Text = "Check for updates", Location = new Point(30, 277), Size = new Size(462, 38), FlatStyle = FlatStyle.System };
      update.Click += async delegate { if (updateZipUrl == null) await CheckForUpdates(true); else await InstallUpdate(); };
      Controls.AddRange(new Control[] { status, detail, open, retry, stop, update });
      open.Enabled = false;
      Shown += async delegate {
        await StartServices();
        if (smokeTest) {
          var passed = open.Enabled;
          File.WriteAllText(Path.Combine(root, "launcher-smoke-test.txt"), passed ? "PASS: bundled services started and health checked" : "FAIL: " + detail.Text);
          Environment.ExitCode = passed ? 0 : 1;
          Close();
        } else {
          await CheckForUpdates(false);
        }
      };
      FormClosing += delegate { StopServices(); };
      monitor.Tick += delegate {
        if (!busy && ((gateway != null && gateway.HasExited) || (dashboard != null && dashboard.HasExited))) {
          StopServices(); status.Text = "A service stopped";
          detail.Text = "Choose Retry to restart. Details are in the logs folder beside AEROLINK.exe.";
        }
      };
    }

    private Button Button(string text, int x, EventHandler handler) {
      var button = new Button { Text = text, Location = new Point(x, 225), Size = new Size(138, 42), FlatStyle = FlatStyle.System };
      button.Click += handler; return button;
    }
    private WebClient GithubClient() {
      ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
      var client = new WebClient();
      client.Headers[HttpRequestHeader.UserAgent] = "AEROLINK-Launcher";
      return client;
    }
    private async Task CheckForUpdates(bool showResult) {
      update.Enabled = false;
      try {
        string json;
        using (var client = GithubClient()) json = await client.DownloadStringTaskAsync("https://api.github.com/repos/JadenAhYuen/AEROLINK/releases/latest");
        var release = (System.Collections.Generic.Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
        var tag = (string)release["tag_name"];
        Version remote, current;
        if (!Version.TryParse(tag.TrimStart('v'), out remote) || !Version.TryParse(CurrentVersion, out current)) throw new Exception("Invalid release version.");
        updateZipUrl = null; updateHashUrl = null;
        if (remote.CompareTo(current) > 0) {
          var expectedName = "AEROLINK-" + remote + "-windows-x64.zip";
          foreach (var item in (object[])release["assets"]) {
            var asset = (System.Collections.Generic.Dictionary<string, object>)item;
            var name = (string)asset["name"];
            if (name == expectedName) updateZipUrl = (string)asset["browser_download_url"];
            if (name == expectedName + ".sha256.txt") updateHashUrl = (string)asset["browser_download_url"];
          }
          if (updateZipUrl != null && updateHashUrl != null) {
            updateVersion = remote.ToString(); update.Text = "Download and open AEROLINK " + updateVersion;
            if (showResult) update.Text = "Download and open AEROLINK " + updateVersion;
          }
        } else if (showResult) { update.Text = "AEROLINK " + CurrentVersion + " is up to date"; }
      } catch (Exception error) {
        if (showResult) detail.Text = "Could not check for updates: " + error.Message;
      } finally { update.Enabled = true; }
    }
    private async Task InstallUpdate() {
      update.Enabled = false; update.Text = "Downloading verified update...";
      try {
        var updatesRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AEROLINK", "updates");
        var target = Path.Combine(updatesRoot, "v" + updateVersion + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(target);
        var zip = Path.Combine(target, "package.zip");
        string expected;
        using (var client = GithubClient()) expected = (await client.DownloadStringTaskAsync(updateHashUrl)).Split(new[] { ' ', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0].ToLowerInvariant();
        if (expected.Length != 64 || expected.Any(c => !Uri.IsHexDigit(c))) throw new Exception("Update checksum is invalid.");
        using (var client = GithubClient()) await client.DownloadFileTaskAsync(new Uri(updateZipUrl), zip);
        string actual;
        using (var stream = File.OpenRead(zip)) using (var hasher = SHA256.Create()) actual = BitConverter.ToString(hasher.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        if (actual != expected) throw new Exception("Update checksum mismatch. The downloaded package was not opened.");
        var extracted = Path.Combine(target, "app");
        ZipFile.ExtractToDirectory(zip, extracted);
        var next = Directory.GetFiles(extracted, "AEROLINK.exe", SearchOption.AllDirectories).FirstOrDefault();
        if (next == null || !File.Exists(Path.Combine(Path.GetDirectoryName(next), "src", "server.js"))) throw new Exception("Update package is incomplete.");
        var oldMedia = Path.Combine(root, "public", "assets", "broll");
        var newMedia = Path.Combine(Path.GetDirectoryName(next), "public", "assets", "broll");
        if (Directory.Exists(oldMedia)) {
          Directory.CreateDirectory(newMedia);
          foreach (var source in Directory.GetFiles(oldMedia)) {
            var extension = Path.GetExtension(source).ToLowerInvariant();
            if (extension != ".mp4" && extension != ".webm") continue;
            var destination = Path.Combine(newMedia, Path.GetFileName(source));
            if (!File.Exists(destination)) File.Copy(source, destination);
          }
        }
        detail.Text = "Verified update installed. Opening AEROLINK " + updateVersion + "...";
        Process.Start(new ProcessStartInfo(next, "--wait-for=" + Process.GetCurrentProcess().Id) { UseShellExecute = true });
        Close();
      } catch (Exception error) {
        detail.Text = "Update could not be installed: " + error.Message;
        update.Text = "Retry update"; update.Enabled = true;
      }
    }
    private void CheckFiles() {
      foreach (var name in new[] { "runtime/node.exe", "runtime/mediamtx.exe", "src/server.js", "public/index.html", "mediamtx.yml" })
        if (!File.Exists(Path.Combine(root, name))) throw new Exception("Missing " + name + ". Extract the entire release ZIP, then open AEROLINK.exe.");
    }
    private string FindAddress() {
      foreach (var nic in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)) {
        var properties = nic.GetIPProperties();
        if (!properties.GatewayAddresses.Any(g => !g.Address.Equals(IPAddress.Any))) continue;
        var ip = properties.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork && !a.Address.ToString().StartsWith("169.254."));
        if (ip != null) return ip.Address.ToString();
      }
      if (smokeTest) return "127.0.0.1";
      throw new Exception("Connect this laptop to Wi-Fi or Ethernet, then choose Retry.");
    }
    private bool PortInUse(int port) {
      return IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p => p.Port == port);
    }
    private Process StartChild(string file, string arguments, string log) {
      Directory.CreateDirectory(Path.Combine(root, "logs"));
      var info = new ProcessStartInfo(Path.Combine(root, file), arguments) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
      info.EnvironmentVariables["MEDIAMTX_API_URL"] = "http://127.0.0.1:9997";
      info.EnvironmentVariables["MTX_WEBRTCADDITIONALHOSTS"] = address;
      info.EnvironmentVariables["MTX_APIADDRESS"] = "127.0.0.1:9997";
      var process = new Process { StartInfo = info };
      var lockObject = new object();
      DataReceivedEventHandler record = delegate(object sender, DataReceivedEventArgs e) {
        if (e.Data == null) return;
        try { lock (lockObject) File.AppendAllText(Path.Combine(root, "logs", log), e.Data + Environment.NewLine); } catch { }
      };
      process.OutputDataReceived += record; process.ErrorDataReceived += record;
      process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine(); return process;
    }
    private async Task StartServices() {
      if (busy) return;
      busy = true; retry.Enabled = false; stop.Enabled = false; open.Enabled = false;
      StopServices(); status.Text = "Starting your flight viewer...";
      try {
        CheckFiles(); address = FindAddress();
        foreach (var port in new[] { 1935, 3000, 8889, 9997 })
          if (PortInUse(port)) throw new Exception("Port " + port + " is in use. Close the previous AEROLINK session or the app using this port, then choose Retry.");
        if (IPGlobalProperties.GetIPGlobalProperties().GetActiveUdpListeners().Any(p => p.Port == 8189))
          throw new Exception("Video port 8189 is in use. Close the other video service, then choose Retry.");
        gateway = StartChild("runtime/mediamtx.exe", "\"" + Path.Combine(root, "mediamtx.yml") + "\"", "gateway.log");
        dashboard = StartChild("runtime/node.exe", "src/server.js", "dashboard.log");
        bool ready = false;
        for (int i = 0; i < 40; i++) {
          if (gateway.HasExited || dashboard.HasExited) throw new Exception("A service could not start. Check the logs folder, then choose Retry.");
          try {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3000/api/health"); request.Timeout = 300; request.Proxy = null;
            using (var response = request.GetResponse()) { ready = PortInUse(1935) && PortInUse(8889); }
          } catch { }
          if (ready) break;
          await Task.Delay(250);
        }
        if (!ready) throw new Exception("Startup took too long. Check the logs folder, then choose Retry.");
        status.Text = "Ready for your aircraft";
        detail.Text = "On this laptop or a tablet:\nhttp://" + address + ":3000\n\nKeep this window open. Closing it stops the viewer.";
        open.Enabled = true; monitor.Start(); if (!smokeTest) OpenViewer();
      } catch (Exception error) {
        StopServices(); status.Text = "Unable to start"; detail.Text = error.Message;
      } finally { busy = false; retry.Enabled = true; stop.Enabled = true; }
    }
    private void OpenViewer() {
      if (String.IsNullOrEmpty(address) || !open.Enabled) return;
      try { Process.Start(new ProcessStartInfo("http://" + address + ":3000") { UseShellExecute = true }); }
      catch { detail.Text = "Open http://" + address + ":3000 in your browser."; }
    }
    private void StopServices() {
      monitor.Stop(); open.Enabled = false;
      foreach (var process in new[] { dashboard, gateway }) {
        if (process == null) continue;
        try { if (!process.HasExited) { process.Kill(); process.WaitForExit(3000); } } catch { }
        process.Dispose();
      }
      dashboard = null; gateway = null;
    }
  }
}
