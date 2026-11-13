using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class ExhibitionLauncher
{
    private const int Port = 8199;
    private static readonly string BaseFolder = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string RuntimeFolder = Path.Combine(BaseFolder, ".runtime-exe");
    private static readonly string StateFile = Path.Combine(RuntimeFolder, "session.txt");
    private static volatile bool Stopping;
    private static TcpListener Listener;
    private static string ContentRoot;
    private static Session Current;

    private sealed class Session
    {
        public int HostId, BrowserId;
        public long HostStarted, BrowserStarted;
        public string Token;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        bool locked = false;
        using (Mutex mutex = new Mutex(false, MutexName()))
        {
            try
            {
                try { locked = mutex.WaitOne(15000); }
                catch (AbandonedMutexException) { locked = true; }
                if (!locked) throw new Exception("다른 전시 실행 명령을 처리 중입니다. 잠시 후 다시 눌러 주세요.");
#if STOP
                StopSession(ReadSession());
                return 0;
#else
                Session previous = ReadSession();
                if (previous != null && OwnedProcess(previous.HostId, previous.HostStarted) != null && Ping(previous)) return 0;
                StopSession(previous);
                ContentRoot = FindContent();
                string chrome = FindChrome();
                Directory.CreateDirectory(RuntimeFolder);
                Listener = new TcpListener(IPAddress.Loopback, Port);
                try { Listener.Start(); }
                catch (SocketException) { throw new Exception("전시 실행 주소(8199번)가 사용 중입니다. 이전 전시를 종료한 뒤 다시 시작해 주세요."); }
                Process host = Process.GetCurrentProcess();
                Current = new Session { HostId = host.Id, HostStarted = host.StartTime.ToUniversalTime().Ticks, Token = Guid.NewGuid().ToString("N") };
                WriteSession(Current);
                bool test = Array.IndexOf(args, "--test-browser") >= 0;
                string profile = Path.Combine(RuntimeFolder, "chrome-profile");
                string browserArgs = "--user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-session-crashed-bubble ";
                browserArgs += test ? "--headless=new --mute-audio about:blank" : "--kiosk http://127.0.0.1:" + Port;
                Process browser = Process.Start(new ProcessStartInfo(chrome, browserArgs) { UseShellExecute = false, CreateNoWindow = true });
                if (browser == null) throw new Exception("Chrome을 열지 못했습니다.");
                Thread.Sleep(700);
                if (browser.HasExited) throw new Exception("전시용 Chrome 창을 열지 못했습니다. 이전 전시 창이 남아 있다면 닫고 다시 시작해 주세요.");
                Current.BrowserId = browser.Id;
                Current.BrowserStarted = browser.StartTime.ToUniversalTime().Ticks;
                WriteSession(Current);
                browser.EnableRaisingEvents = true;
                browser.Exited += delegate { RequestStop(); };
                mutex.ReleaseMutex(); locked = false;
                while (!Stopping)
                {
                    try
                    {
                        TcpClient client = Listener.AcceptTcpClient();
                        ThreadPool.QueueUserWorkItem(delegate { Serve(client); });
                    }
                    catch (SocketException) { if (!Stopping) throw; }
                    catch (ObjectDisposedException) { if (!Stopping) throw; }
                }
                return 0;
#endif
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "전시 운영", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
#if !STOP
                if (Current != null)
                {
                    RequestStop();
                    KillBrowser(Current);
                    Session saved = ReadSession();
                    if (saved != null && saved.Token == Current.Token) File.Delete(StateFile);
                }
#endif
                if (locked) mutex.ReleaseMutex();
            }
        }
    }

    private static string MutexName()
    {
        using (SHA256 hash = SHA256.Create())
            return "Local\\JamoExhibitionExe-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(BaseFolder.ToLowerInvariant()))).Replace("-", "");
    }

    private static string FindContent()
    {
        foreach (string folder in new[] { Path.Combine(BaseFolder, "콘텐츠"), Path.GetFullPath(Path.Combine(BaseFolder, "..", "skateboardword")) })
            if (File.Exists(Path.Combine(folder, "index.html"))) return Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar);
        throw new Exception("콘텐츠 폴더를 찾지 못했습니다. 실행 파일 두 개와 ‘콘텐츠’ 폴더를 함께 옮겨 주세요.");
    }

    private static string FindChrome()
    {
        List<string> paths = new List<string>();
        foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (RegistryKey key = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
                if (key != null && key.GetValue("") is string) paths.Add(((string)key.GetValue("")).Trim('"'));
        }
        foreach (string folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
            if (!String.IsNullOrEmpty(folder)) paths.Add(Path.Combine(folder, @"Google\Chrome\Application\chrome.exe"));
        foreach (string candidate in paths) if (File.Exists(candidate)) return candidate;
        throw new Exception("Chrome이 설치되어 있지 않습니다. 전시 PC에 Chrome을 설치한 뒤 다시 실행해 주세요.");
    }

    private static Session ReadSession()
    {
        if (!File.Exists(StateFile)) return null;
        try
        {
            string[] values = File.ReadAllLines(StateFile);
            return new Session { HostId = Int32.Parse(values[0], CultureInfo.InvariantCulture), HostStarted = Int64.Parse(values[1], CultureInfo.InvariantCulture), Token = values[2], BrowserId = Int32.Parse(values[3], CultureInfo.InvariantCulture), BrowserStarted = Int64.Parse(values[4], CultureInfo.InvariantCulture) };
        }
        catch (IOException) { return null; }
        catch (FormatException) { return null; }
        catch (IndexOutOfRangeException) { return null; }
    }

    private static void WriteSession(Session state)
    {
        File.WriteAllLines(StateFile, new[] { state.HostId.ToString(CultureInfo.InvariantCulture), state.HostStarted.ToString(CultureInfo.InvariantCulture), state.Token, state.BrowserId.ToString(CultureInfo.InvariantCulture), state.BrowserStarted.ToString(CultureInfo.InvariantCulture) });
    }

    private static Process OwnedProcess(int id, long started)
    {
        if (id <= 0 || started <= 0) return null;
        try
        {
            Process process = Process.GetProcessById(id);
            return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == started ? process : null;
        }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    private static bool Ping(Session state)
    {
        try
        {
            HttpWebRequest request = ControlRequest(state, "status", "GET");
            using (WebResponse response = request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd() == "jamo-exhibition-exe";
        }
        catch (WebException) { return false; }
    }

    private static HttpWebRequest ControlRequest(Session state, string route, string method)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/__exhibition/" + route);
        request.Proxy = null; request.KeepAlive = false; request.Timeout = 2000; request.ReadWriteTimeout = 2000; request.Method = method;
        request.Headers.Add("X-Exhibition-Token", state.Token);
        if (method == "POST") request.ContentLength = 0;
        return request;
    }

    private static void StopSession(Session state)
    {
        if (state == null) return;
        Process host = OwnedProcess(state.HostId, state.HostStarted);
        if (host != null)
        {
            string expected = Path.Combine(BaseFolder, "전시 시작.exe");
            if (!String.Equals(host.MainModule.FileName, expected, StringComparison.OrdinalIgnoreCase))
                throw new Exception("이 폴더에서 실행한 전시인지 확인하지 못했습니다. 기존 창을 직접 닫아 주세요.");
            try { using (WebResponse response = ControlRequest(state, "stop", "POST").GetResponse()) { } }
            catch (WebException) { }
            if (!host.WaitForExit(6000))
            {
                Process owned = OwnedProcess(state.HostId, state.HostStarted);
                if (owned != null) { owned.Kill(); owned.WaitForExit(3000); }
            }
        }
        KillBrowser(state);
        if (File.Exists(StateFile)) File.Delete(StateFile);
    }

    private static void KillBrowser(Session state)
    {
        Process browser = OwnedProcess(state.BrowserId, state.BrowserStarted);
        if (browser == null || !String.Equals(browser.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase)) return;
        string taskkill = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe");
        using (Process stop = Process.Start(new ProcessStartInfo(taskkill, "/PID " + state.BrowserId + " /T /F") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden }))
            if (stop != null) stop.WaitForExit(5000);
    }

    private static void RequestStop()
    {
        Stopping = true;
        if (Listener != null) Listener.Stop();
    }

    private static void Serve(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 5000; client.SendTimeout = 15000;
                using (NetworkStream stream = client.GetStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.ASCII, false, 4096))
                {
                    string first = reader.ReadLine();
                    if (first == null || first.Length > 8192) return;
                    string[] request = first.Split(' ');
                    if (request.Length < 3) { Reply(stream, 400, "Bad request", false); return; }
                    Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    int size = first.Length; string line;
                    while (!String.IsNullOrEmpty(line = reader.ReadLine()))
                    {
                        size += line.Length;
                        if (size > 16384) { Reply(stream, 400, "Bad request", false); return; }
                        int colon = line.IndexOf(':');
                        if (colon > 0) headers[line.Substring(0, colon)] = line.Substring(colon + 1).Trim();
                    }
                    string pathname = Uri.UnescapeDataString(new Uri("http://localhost" + request[1]).AbsolutePath);
                    string supplied; bool authorized = headers.TryGetValue("X-Exhibition-Token", out supplied) && supplied == Current.Token;
                    if (pathname == "/__exhibition/status" && authorized && request[0] == "GET") { Reply(stream, 200, "jamo-exhibition-exe", false); return; }
                    if (pathname == "/__exhibition/stop" && authorized && request[0] == "POST") { Reply(stream, 200, "stopping", false); RequestStop(); return; }
                    if (request[0] != "GET" && request[0] != "HEAD") { Reply(stream, 405, "Method not allowed", false); return; }
                    bool head = request[0] == "HEAD";
                    if (pathname.Contains("\\") || pathname.Contains(":") || pathname.Contains("\0")) { Reply(stream, 404, "Not found", head); return; }
                    foreach (string part in pathname.Split('/')) if (part.StartsWith(".", StringComparison.Ordinal)) { Reply(stream, 404, "Not found", head); return; }
                    string file = Path.GetFullPath(Path.Combine(ContentRoot, pathname.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
                    if (Directory.Exists(file)) file = Path.Combine(file, "index.html");
                    if (!file.StartsWith(ContentRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) { Reply(stream, 404, "Not found", head); return; }
                    using (FileStream data = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    {
                        Header(stream, 200, Mime(file), data.Length);
                        if (!head) data.CopyTo(stream);
                    }
                }
            }
            catch (IOException) { }
            catch (SocketException) { }
            catch (ArgumentException) { }
            catch (UriFormatException) { }
        }
    }

    private static void Reply(Stream stream, int code, string text, bool head)
    {
        byte[] body = Encoding.UTF8.GetBytes(text); Header(stream, code, "text/plain; charset=utf-8", body.Length); if (!head) stream.Write(body, 0, body.Length);
    }

    private static void Header(Stream stream, int code, string type, long length)
    {
        string reason = code == 200 ? "OK" : code == 404 ? "Not Found" : code == 405 ? "Method Not Allowed" : "Bad Request";
        byte[] bytes = Encoding.ASCII.GetBytes("HTTP/1.1 " + code + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + length + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n");
        stream.Write(bytes, 0, bytes.Length);
    }

    private static string Mime(string file)
    {
        switch (Path.GetExtension(file).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": case ".cjs": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json";
            case ".png": return "image/png";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".svg": return "image/svg+xml";
            case ".webp": return "image/webp";
            case ".wasm": return "application/wasm";
            case ".webm": return "video/webm";
            case ".mp3": return "audio/mpeg";
            default: return "application/octet-stream";
        }
    }
}
