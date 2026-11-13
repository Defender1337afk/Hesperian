using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Hesperian.Setup
{
    sealed class SetupForm : Form
    {
        enum Screen { Start, Working, Done, Failed }

        sealed class Hit
        {
            public string Id;
            public RectangleF Rect;
            public Action Click;
        }

        const int BaseW = 620, BaseH = 460, CaptionH = 38, StatusH = 24, PadX = 44, Radius = 8;
        const float RevealFrames = 60f;
        static readonly string[] Tips =
        {
            "Каждая сборка хранит свои моды, миры и настройки",
            "Нужная версия Java поставится сама при первом запуске",
            "Ctrl+Shift+P открывает все команды лаунчера",
            "Другие темы и тема «Кристалл» есть в настройках лаунчера"
        };

        readonly Options _o;
        readonly bool _uninstall;
        readonly Timer _timer = new Timer { Interval = 16 };
        readonly List<Hit> _hits = new List<Hit>();
        readonly Dictionary<string, float> _hover = new Dictionary<string, float>();
        readonly Dictionary<string, float> _switch = new Dictionary<string, float>();
        readonly Dictionary<string, float> _switchTarget = new Dictionary<string, float>();
        Screen _screen = Screen.Start;
        string _mouse, _pressed, _focus;
        bool _keyboard;
        readonly bool _preview;
        string _error = "", _file = "";
        float _target, _shown, _enter;
        int _tick;
        volatile bool _workDone;
        Exception _workError;
        Font _font, _small, _medium, _semi, _hero;

        public SetupForm(Options options, bool uninstall, string preview = null)
        {
            _o = options;
            _uninstall = uninstall;
            _preview = preview != null;
            if (preview != null && preview.EndsWith("working"))
            {
                _screen = Screen.Working;
                _target = _shown = 0.62f;
                _file = "icudtl.dat";
            }
            else if (preview != null && preview.EndsWith("done")) _screen = Screen.Done;
            else if (preview != null && preview.EndsWith("failed"))
            {
                _screen = Screen.Failed;
                _error = "Hesperian сейчас запущен. Закройте его и повторите.";
            }
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;
            KeyPreview = true;
            Text = uninstall ? "Удаление Hesperian" : "Установка Hesperian";
            Icon = Icon.ExtractAssociatedIcon(Engine.SelfPath);
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.Selectable, true);
            _timer.Tick += (_, __) => Animate();
            BackColor = Grove.Bg;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int CS_DROPSHADOW = 0x20000;
                var cp = base.CreateParams;
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Grove.LoadFonts();
            ApplyScale(WindowDpi());
            int round = 2;
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        }

        int WindowDpi()
        {
            try { return (int)GetDpiForWindow(Handle); }
            catch (EntryPointNotFoundException) { return 96; }
        }

        void ApplyScale(int dpi)
        {
            Grove.Scale = dpi / 96f;
            Size = new Size(Grove.S(BaseW), Grove.S(BaseH));
            foreach (var f in new[] { _font, _small, _medium, _semi, _hero }) f?.Dispose();
            _font = Grove.Font("", 13);
            _small = Grove.Font("", 11.5f);
            _medium = Grove.Font("Medium", 13);
            _semi = Grove.Font("SemiBold", 13);
            _hero = Grove.Font("", 15);
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_DPICHANGED = 0x02E0;
            if (m.Msg == WM_DPICHANGED)
            {
                ApplyScale((m.WParam.ToInt32() >> 16) & 0xFFFF);
                var center = new Point(Left + Width / 2, Top + Height / 2);
                Location = new Point(center.X - Width / 2, center.Y - Height / 2);
                Invalidate();
                m.Result = IntPtr.Zero;
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            CenterToScreen();
            _timer.Start();
            if (!_uninstall) _focus = "primary";
        }

        void Animate()
        {
            _tick++;
            bool dirty = _screen == Screen.Working || _enter < 1f;
            _enter = Math.Min(1f, _enter + 1f / RevealFrames);
            foreach (var hit in _hits.ToList())
            {
                float was = _hover.TryGetValue(hit.Id, out var v) ? v : 0;
                float next = Grove.Approach(was, _mouse == hit.Id ? 1 : 0, 0.14f);
                if (next != was) { _hover[hit.Id] = next; dirty = true; }
            }
            foreach (var id in _switchTarget.Keys.ToList())
            {
                float was = _switch[id], next = Grove.Approach(was, _switchTarget[id], 0.1f);
                if (next != was) { _switch[id] = next; dirty = true; }
            }
            if (_screen == Screen.Working)
            {
                _shown += (_target - _shown) * 0.12f;
                if (_workDone && _shown > _target - 0.003f) Finish();
            }
            if (dirty) Invalidate();
        }

        void Finish()
        {
            if (_workError != null)
            {
                _error = _workError.Message;
                Go(Screen.Failed);
            }
            else Go(Screen.Done);
        }

        void Go(Screen screen)
        {
            _screen = screen;
            _enter = 0;
            _focus = "primary";
            Invalidate();
        }

        void Start()
        {
            if (_preview) return;
            _workDone = false;
            _workError = null;
            _target = _shown = 0;
            Go(Screen.Working);
            Action<float, string> report = (p, f) =>
            {
                _target = p;
                _file = f;
            };
            Task.Run(() =>
            {
                try
                {
                    if (_uninstall) Engine.Uninstall(_o, report);
                    else Engine.Install(_o, report);
                }
                catch (Exception e)
                {
                    _workError = e;
                }
                _workDone = true;
            });
        }

        void PickFolder()
        {
            if (_preview) return;
            var picked = FolderPicker.Show(Handle, Path.GetDirectoryName(_o.Dir));
            if (picked != null)
            {
                _o.Dir = Engine.NormalizeDir(picked);
                Invalidate();
            }
        }

        void CloseWindow()
        {
            if (_screen == Screen.Working && !_preview) return;
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (_screen == Screen.Working && e.CloseReason == CloseReason.UserClosing && !_preview) e.Cancel = true;
            else if (_uninstall && _screen == Screen.Done && !_preview) Engine.ScheduleSelfRemoval(_o.Dir);
            base.OnFormClosing(e);
        }

        protected override void OnPaintBackground(PaintEventArgs e) { }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Grove.Smooth(g);
            using (var bg = new SolidBrush(Grove.Bg)) g.FillRectangle(bg, ClientRectangle);
            _hits.Clear();
            DrawCaption(g);
            DrawStatus(g);
            switch (_screen)
            {
                case Screen.Start:
                    if (_uninstall) DrawUninstallStart(g);
                    else DrawStart(g);
                    break;
                case Screen.Working:
                    DrawWorking(g);
                    break;
                case Screen.Done:
                    DrawDone(g);
                    break;
                case Screen.Failed:
                    DrawFailed(g);
                    break;
            }
            base.OnPaint(e);
        }

        float F(float v) => Grove.F(v);
        float Hov(string id) => _hover.TryGetValue(id, out var v) ? v : 0;

        float Reveal(int index)
        {
            float t = (_enter * RevealFrames - index * 3.3f) / 30f;
            return t < 0 ? 0 : t > 1 ? 1 : Grove.Ease(t);
        }

        float RiseOffset(int index) => (1 - Reveal(index)) * F(10);
        Color In(Color c, int index) => Grove.Mix(Grove.Bg, c, Reveal(index));

        void Label(Graphics g, string text, Font font, RectangleF r, Color color, TextFormatFlags flags)
        {
            TextRenderer.DrawText(g, text, font, Rectangle.Round(r), color, flags | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.PreserveGraphicsClipping);
        }

        const TextFormatFlags Center = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
        const TextFormatFlags Left_ = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
        const TextFormatFlags Right_ = TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine;
        const TextFormatFlags Wrap = TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis;

        void AddHit(string id, RectangleF r, Action click) => _hits.Add(new Hit { Id = id, Rect = r, Click = click });

        void HairLine(Graphics g, float x1, float x2, float y, Color color)
        {
            using (var pen = new Pen(color, Math.Max(1f, F(1))))
                g.DrawLine(pen, x1, y, x2, y);
        }

        void DrawCaption(Graphics g)
        {
            float w = ClientSize.Width, h = F(CaptionH);
            Grove.Apple(g, new RectangleF(F(13), (h - F(16)) / 2, F(16), F(16)), Grove.Accent);
            Label(g, _uninstall ? "Удаление" : "Установка", _font, new RectangleF(F(38), 0, F(200), h), Grove.Muted, Left_);
            HairLine(g, 0, w, h - 0.5f, Grove.Line);

            if (_screen == Screen.Working) return;
            var r = new RectangleF(w - F(44), 0, F(44), h - 1);
            AddHit("close", r, CloseWindow);
            float t = Hov("close");
            if (t > 0.01f)
                using (var b = new SolidBrush(Grove.Fade(Grove.CloseHover, t))) g.FillRectangle(b, r);
            using (var pen = new Pen(Grove.Mix(Grove.Muted, Color.White, t), F(1.3f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                float c = F(4.5f), cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2;
                g.DrawLine(pen, cx - c, cy - c, cx + c, cy + c);
                g.DrawLine(pen, cx + c, cy - c, cx - c, cy + c);
            }
            if (_focus == "close") Focus(g, RectangleF.Inflate(r, -F(3), -F(3)), F(4));
        }

        void DrawStatus(Graphics g)
        {
            float w = ClientSize.Width, h = F(StatusH), y = ClientSize.Height - h;
            HairLine(g, 0, w, y + 0.5f, Grove.Line);
            Label(g, $"Hesperian {Engine.Version}", _small, new RectangleF(F(15), y, F(240), h), Grove.Faint, Left_);
            Label(g, "Лицензия GNU GPL v3", _small, new RectangleF(w - F(215), y, F(200), h), Grove.Faint, Right_);
        }

        void Focus(Graphics g, RectangleF r, float rad)
        {
            if (!_keyboard) return;
            using (var pen = new Pen(Grove.Accent, F(1.5f)))
            using (var p = Grove.Round(RectangleF.Inflate(r, F(2), F(2)), rad + F(2)))
                g.DrawPath(pen, p);
        }

        void Primary(Graphics g, string id, string text, RectangleF r, Action click, bool danger = false)
        {
            AddHit(id, r, click);
            float t = Hov(id);
            var fill = danger ? Grove.Danger : Grove.Mix(Grove.Text, Grove.Bg, 0.12f * t);
            if (_pressed == id) r = RectangleF.Inflate(r, -F(0.8f), -F(0.4f));
            using (var p = Grove.Round(r, F(Radius)))
            using (var b = new SolidBrush(fill))
                g.FillPath(b, p);
            Label(g, text, _semi, r, danger ? Color.White : Grove.Bg, Center);
            if (_focus == id) Focus(g, r, F(Radius));
        }

        void Secondary(Graphics g, string id, string text, RectangleF r, Action click)
        {
            AddHit(id, r, click);
            float t = Hov(id);
            if (_pressed == id) r = RectangleF.Inflate(r, -F(0.8f), -F(0.4f));
            using (var p = Grove.Round(RectangleF.Inflate(r, -0.5f, -0.5f), F(Radius)))
            {
                if (t > 0.01f)
                    using (var b = new SolidBrush(Grove.Fade(Grove.Hover, t))) g.FillPath(b, p);
                using (var pen = new Pen(Grove.Mix(Grove.LineStrong, Grove.Faint, t), Math.Max(1f, F(1)))) g.DrawPath(pen, p);
            }
            Label(g, text, _medium, r, Grove.Text, Center);
            if (_focus == id) Focus(g, r, F(Radius));
        }

        void Row(Graphics g, int index, float y, float h, string title, string note, Color noteColor)
        {
            float pad = F(PadX), w = ClientSize.Width, dy = RiseOffset(index);
            float top = y + dy;
            if (note == null)
            {
                Label(g, title, _medium, new RectangleF(pad, top, w - pad * 2 - F(150), h), In(Grove.Text, index), Left_);
            }
            else
            {
                Label(g, title, _medium, new RectangleF(pad, top + h / 2 - F(19), w - pad * 2 - F(110), F(19)), In(Grove.Text, index), Left_);
                Label(g, note, _small, new RectangleF(pad, top + h / 2 + F(1), w - pad * 2 - F(110), F(18)), In(noteColor, index), Left_ | TextFormatFlags.PathEllipsis);
            }
            HairLine(g, pad, w - pad, top + h - 0.5f, Grove.Fade(Grove.Line, Reveal(index)));
        }

        void ToggleRow(Graphics g, int index, string id, float y, string title, bool on, Action click)
        {
            float h = F(46), pad = F(PadX), w = ClientSize.Width, dy = RiseOffset(index);
            Row(g, index, y, h, title, null, Grove.Muted);
            AddHit(id, new RectangleF(pad, y + dy, w - pad * 2, h), click);
            float target = on ? 1 : 0;
            float pos = _switch.TryGetValue(id, out var v) ? v : target;
            _switch[id] = pos;
            _switchTarget[id] = target;

            var track = new RectangleF(w - pad - F(34), y + dy + (h - F(20)) / 2, F(34), F(20));
            float alpha = Reveal(index);
            using (var p = Grove.Round(track, track.Height / 2))
            {
                using (var b = new SolidBrush(Grove.Fade(Grove.Mix(Grove.Raised2, Grove.Accent, pos), alpha))) g.FillPath(b, p);
                if (pos < 0.99f)
                    using (var edge = new Pen(Grove.Fade(Grove.LineStrong, alpha * (1 - pos)), Math.Max(1f, F(1)))) g.DrawPath(edge, p);
            }
            float d = F(14), x = track.X + F(3) + (track.Width - d - F(6)) * Grove.Ease(pos);
            using (var b = new SolidBrush(Grove.Fade(Grove.Mix(Grove.Muted, Grove.OnAccent, pos), alpha)))
                g.FillEllipse(b, x, track.Y + (track.Height - d) / 2, d, d);
            if (_focus == id) Focus(g, track, track.Height / 2);
        }

        void Heading(Graphics g, string word, Color dot, string sub, Color subColor)
        {
            float pad = F(PadX);
            Grove.Wordmark(g, word, dot, F(50), new PointF(pad - F(2), F(CaptionH + 26) + RiseOffset(0)), Reveal(0));
            Label(g, sub, _hero, new RectangleF(pad, F(CaptionH + 92) + RiseOffset(1), ClientSize.Width - pad * 2, F(46)), In(subColor, 1), Wrap);
        }

        float ButtonY => ClientSize.Height - F(StatusH) - F(50);

        void DrawStart(Graphics g)
        {
            Heading(g, "Hesperian", Grove.Accent, "Собирай, запускай, играй.", Grove.Muted);
            float pad = F(PadX), w = ClientSize.Width, y = F(CaptionH + 140);

            float rowH = F(54), dy = RiseOffset(2);
            Row(g, 2, y, rowH, "Папка установки", _o.Dir, Grove.Muted);
            Secondary(g, "pick", "Изменить", new RectangleF(w - pad - F(92), y + dy + (rowH - F(30)) / 2, F(92), F(30)), PickFolder);
            y += rowH;
            ToggleRow(g, 3, "desktop", y, "Ярлык на рабочем столе", _o.Desktop, () => { _o.Desktop = !_o.Desktop; Invalidate(); });
            y += F(46);
            ToggleRow(g, 4, "startmenu", y, "Ярлык в меню «Пуск»", _o.StartMenu, () => { _o.StartMenu = !_o.StartMenu; Invalidate(); });

            Label(g, "Права администратора не нужны", _small, new RectangleF(pad, ButtonY, F(260), F(34)), In(Grove.Faint, 5), Left_);
            Primary(g, "primary", "Установить", new RectangleF(w - pad - F(130), ButtonY + RiseOffset(5), F(130), F(34)), Start);
        }

        void DrawUninstallStart(Graphics g)
        {
            Heading(g, "Удаление", Grove.DangerText, "Файлы программы будут удалены. Сборки, миры и настройки останутся, если не включить опцию ниже.", Grove.Muted);
            float pad = F(PadX), w = ClientSize.Width, y = F(CaptionH + 156);
            ToggleRow(g, 2, "purge", y, "Удалить ещё и сборки, миры и настройки", _o.Purge, () => { _o.Purge = !_o.Purge; Invalidate(); });
            if (_o.Purge)
                Label(g, Engine.DataDir, _small, new RectangleF(pad, y + F(52), w - pad * 2, F(18)), Grove.DangerText, Left_ | TextFormatFlags.PathEllipsis);
            Secondary(g, "cancel", "Отмена", new RectangleF(w - pad - F(130) - F(100), ButtonY + RiseOffset(3), F(92), F(34)), CloseWindow);
            Primary(g, "primary", "Удалить", new RectangleF(w - pad - F(130), ButtonY + RiseOffset(3), F(130), F(34)), Start, true);
        }

        void DrawWorking(Graphics g)
        {
            float pad = F(PadX), w = ClientSize.Width;
            int percent = (int)Math.Round(Math.Min(1f, _shown) * 100);
            Heading(g, _uninstall ? "Удаляем" : "Ставим", Grove.Accent, _uninstall ? "Убираем файлы программы." : "Это займёт несколько секунд.", Grove.Muted);

            float y = F(CaptionH + 176) + RiseOffset(2);
            var bar = new RectangleF(pad, y, w - pad * 2, F(3));
            using (var track = Grove.Round(bar, bar.Height / 2))
            using (var b = new SolidBrush(In(Grove.Raised2, 2)))
                g.FillPath(b, track);
            var done = new RectangleF(bar.X, bar.Y, Math.Max(bar.Height, bar.Width * Math.Min(1f, _shown)), bar.Height);
            using (var fill = Grove.Round(done, bar.Height / 2))
            using (var b = new SolidBrush(Grove.Accent))
                g.FillPath(b, fill);

            Label(g, _file, _small, new RectangleF(pad, y + F(12), w - pad * 2 - F(60), F(18)), In(Grove.Faint, 3), Left_);
            Label(g, $"{percent}%", _medium, new RectangleF(w - pad - F(60), y + F(12), F(60), F(18)), In(Grove.Muted, 3), Right_);

            if (!_uninstall)
            {
                float tipY = ButtonY + F(6);
                HairLine(g, pad, w - pad, tipY - F(10), Grove.Line);
                Label(g, Tips[_tick / 260 % Tips.Length], _font, new RectangleF(pad, tipY, w - pad * 2, F(24)), Grove.Muted, Left_);
            }
        }

        void DrawDone(Graphics g)
        {
            float pad = F(PadX), w = ClientSize.Width;
            if (_uninstall)
            {
                Heading(g, "Удалено", Grove.Accent, "Hesperian больше нет на этом компьютере.", Grove.Muted);
                Primary(g, "primary", "Закрыть", new RectangleF(w - pad - F(130), ButtonY + RiseOffset(2), F(130), F(34)), CloseWindow);
                return;
            }
            Heading(g, "Готово", Grove.Accent, "Hesperian установлен. Осталось создать сборку и нажать «Играть».", Grove.Muted);
            Secondary(g, "cancel", "Закрыть", new RectangleF(w - pad - F(130) - F(100), ButtonY + RiseOffset(2), F(92), F(34)), CloseWindow);
            Primary(g, "primary", "Запустить", new RectangleF(w - pad - F(130), ButtonY + RiseOffset(2), F(130), F(34)), () =>
            {
                if (!_preview) Engine.LaunchApp(_o.Dir);
                CloseWindow();
            });
        }

        void DrawFailed(Graphics g)
        {
            float pad = F(PadX), w = ClientSize.Width;
            Heading(g, "Не вышло", Grove.DangerText, _error, Grove.Muted);
            Secondary(g, "cancel", "Закрыть", new RectangleF(w - pad - F(130) - F(100), ButtonY + RiseOffset(2), F(92), F(34)), CloseWindow);
            Primary(g, "primary", "Повторить", new RectangleF(w - pad - F(130), ButtonY + RiseOffset(2), F(130), F(34)), Start);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            var hit = _hits.LastOrDefault(h => h.Rect.Contains(e.Location));
            _mouse = hit?.Id;
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _mouse = null;
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            var hit = _hits.LastOrDefault(h => h.Rect.Contains(e.Location));
            if (hit != null)
            {
                _pressed = hit.Id;
                Invalidate();
                return;
            }
            ReleaseCapture();
            SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            var hit = _hits.LastOrDefault(h => h.Rect.Contains(e.Location));
            var pressed = _pressed;
            _pressed = null;
            Invalidate();
            if (hit != null && hit.Id == pressed) hit.Click();
        }

        protected override bool ProcessDialogKey(Keys key)
        {
            var hit = _hits.FirstOrDefault(h => h.Id == _focus);
            switch (key & Keys.KeyCode)
            {
                case Keys.Tab:
                    if (_hits.Count > 0)
                    {
                        _keyboard = true;
                        int i = _hits.FindIndex(h => h.Id == _focus);
                        int step = (key & Keys.Shift) == 0 ? 1 : -1;
                        _focus = _hits[(i + step + _hits.Count) % _hits.Count].Id;
                        Invalidate();
                    }
                    return true;
                case Keys.Enter:
                case Keys.Space:
                    hit?.Click();
                    return true;
                case Keys.Escape:
                    CloseWindow();
                    return true;
            }
            return base.ProcessDialogKey(key);
        }

        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hWnd);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    }

    static class FolderPicker
    {
        public static string Show(IntPtr owner, string initial)
        {
            var dialog = (IFileOpenDialog)new FileOpenDialogRcw();
            try
            {
                dialog.GetOptions(out uint options);
                dialog.SetOptions(options | 0x20 | 0x40);
                dialog.SetTitle("Куда установить Hesperian");
                if (Directory.Exists(initial) && SHCreateItemFromParsingName(initial, IntPtr.Zero, typeof(IShellItem).GUID, out var start) == 0)
                    dialog.SetFolder(start);
                if (dialog.Show(owner) != 0) return null;
                dialog.GetResult(out var item);
                item.GetDisplayName(0x80058000, out var path);
                return path;
            }
            finally
            {
                Marshal.ReleaseComObject(dialog);
            }
        }

        [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")] class FileOpenDialogRcw { }

        [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileOpenDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes(uint count, IntPtr types);
            void SetFileTypeIndex(uint index);
            void GetFileTypeIndex(out uint index);
            void Advise(IntPtr events, out uint cookie);
            void Unadvise(uint cookie);
            void SetOptions(uint options);
            void GetOptions(out uint options);
            void SetDefaultFolder(IShellItem item);
            void SetFolder(IShellItem item);
            void GetFolder(out IShellItem item);
            void GetCurrentSelection(out IShellItem item);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
            void GetResult(out IShellItem item);
        }

        [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem parent);
            void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);
    }
}
