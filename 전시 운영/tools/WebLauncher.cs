using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class WebLauncher
{
    private const string Url = "https://tymz01lab-hub.github.io/skateboardword/";
    [STAThread]
    private static int Main(string[] args)
    {
        bool test = Array.IndexOf(args, "--test-browser") >= 0;
        string folder = Path.Combine(test ? Path.GetTempPath() : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), test ? "JamoSkateExhibition-Web-QA" : "JamoSkateExhibition-Web");
        string state = Path.Combine(folder, "browser.txt");
        bool locked = false;
        using (Mutex mutex = new Mutex(false, "Local\\JamoSkateExhibition-Web" + (test ? "-QA" : "")))
        {
            try
            {
                try { locked = mutex.WaitOne(10000); } catch (AbandonedMutexException) { locked = true; }
                if (!locked) throw new Exception("다른 실행 명령을 처리 중입니다. 잠시 후 다시 눌러 주세요.");
                Process previous = OwnedBrowser(state);
#if STOP
                if (previous != null)
                {
                    string taskkill = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe");
                    using (Process stop = Process.Start(new ProcessStartInfo(taskkill, "/PID " + previous.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden }))
                        if (stop != null) stop.WaitForExit(5000);
                }
                if (File.Exists(state)) File.Delete(state);
#else
                if (previous != null) return 0;
                string chrome = FindChrome();
                Directory.CreateDirectory(folder);
                string options = "--user-data-dir=\"" + Path.Combine(folder, "chrome-profile") + "\" --no-first-run --no-default-browser-check --disable-session-crashed-bubble ";
                options += test ? "--headless=new --mute-audio about:blank" : "--kiosk " + Url;
                Process browser = Process.Start(new ProcessStartInfo(chrome, options) { UseShellExecute = false, CreateNoWindow = true });
                Thread.Sleep(500);
                if (browser == null || browser.HasExited) throw new Exception("전시용 Chrome 창을 열지 못했습니다. 기존 전시 창을 닫고 다시 시작해 주세요.");
                File.WriteAllLines(state, new[] { browser.Id.ToString(), browser.StartTime.ToUniversalTime().Ticks.ToString() });
#endif
                return 0;
            }
            catch (Exception error) { MessageBox.Show(error.Message, "전시 운영", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
            finally { if (locked) mutex.ReleaseMutex(); }
        }
    }
    private static Process OwnedBrowser(string state)
    {
        if (!File.Exists(state)) return null;
        try
        {
            string[] values = File.ReadAllLines(state);
            Process browser = Process.GetProcessById(Int32.Parse(values[0]));
            return !browser.HasExited && browser.ProcessName == "chrome" && browser.StartTime.ToUniversalTime().Ticks == Int64.Parse(values[1]) ? browser : null;
        }
        catch (IOException) { return null; }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (FormatException) { return null; }
        catch (IndexOutOfRangeException) { return null; }
    }
    private static string FindChrome()
    {
        foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            using (RegistryKey key = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
                if (key != null && key.GetValue("") is string)
                {
                    string chrome = ((string)key.GetValue("")).Trim('"');
                    if (File.Exists(chrome)) return chrome;
                }
        foreach (string root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
        {
            if (String.IsNullOrEmpty(root)) continue;
            string chrome = Path.Combine(root, @"Google\Chrome\Application\chrome.exe");
            if (File.Exists(chrome)) return chrome;
        }
        throw new Exception("전시 PC에 Chrome을 설치한 뒤 다시 실행해 주세요.");
    }
}
