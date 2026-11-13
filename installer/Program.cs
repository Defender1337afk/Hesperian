using System;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Hesperian.Setup
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            bool uninstall = args.Contains("--uninstall") || !Engine.HasPayload();
            bool silent = args.Contains("--silent");
            int dirIndex = Array.IndexOf(args, "--dir");
            var chosen = dirIndex >= 0 && dirIndex + 1 < args.Length ? args[dirIndex + 1] : null;

            var options = new Options
            {
                Dir = uninstall
                    ? Path.GetDirectoryName(Engine.SelfPath)
                    : chosen != null ? Engine.NormalizeDir(chosen) : Engine.InitialDir(),
                Desktop = !args.Contains("--no-desktop"),
                StartMenu = !args.Contains("--no-start-menu"),
                Purge = args.Contains("--purge")
            };

            int previewIndex = Array.IndexOf(args, "--preview");
            if (previewIndex >= 0 && previewIndex + 1 < args.Length)
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SetupForm(options, args[previewIndex + 1].StartsWith("uninstall"), args[previewIndex + 1]));
                return 0;
            }

            if (silent)
            {
                try
                {
                    if (uninstall)
                    {
                        Engine.Uninstall(options, (_, __) => { });
                        Engine.ScheduleSelfRemoval(options.Dir);
                    }
                    else Engine.Install(options, (_, __) => { });
                    return 0;
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine(e.Message);
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(options, uninstall));
            return 0;
        }
    }
}
