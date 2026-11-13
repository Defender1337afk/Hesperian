using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Hesperian.Setup
{
    static class Grove
    {
        public static readonly Color Bg = Color.FromArgb(0x0C, 0x11, 0x0E);
        public static readonly Color Line = Color.FromArgb(17, 220, 255, 230);
        public static readonly Color LineStrong = Color.FromArgb(31, 220, 255, 230);
        public static readonly Color Hover = Color.FromArgb(11, 220, 255, 230);
        public static readonly Color Raised2 = Color.FromArgb(0x1C, 0x25, 0x1F);
        public static readonly Color Text = Color.FromArgb(0xE1, 0xE9, 0xE3);
        public static readonly Color Muted = Color.FromArgb(0x8A, 0x97, 0x8E);
        public static readonly Color Faint = Color.FromArgb(0x6A, 0x78, 0x6F);
        public static readonly Color Accent = Color.FromArgb(0x71, 0xD6, 0x9B);
        public static readonly Color OnAccent = Color.FromArgb(0x09, 0x25, 0x15);
        public static readonly Color Danger = Color.FromArgb(0xD9, 0x53, 0x4F);
        public static readonly Color DangerText = Color.FromArgb(0xE5, 0x73, 0x6D);
        public static readonly Color CloseHover = Color.FromArgb(0xC4, 0x2B, 0x1C);

        public static float Scale = 1f;
        public static float F(float v) => v * Scale;
        public static int S(float v) => (int)Math.Round(v * Scale);

        static readonly PrivateFontCollection Fonts = new PrivateFontCollection();
        static readonly List<IntPtr> FontMemory = new List<IntPtr>();

        public static void LoadFonts()
        {
            var assembly = Assembly.GetExecutingAssembly();
            foreach (var name in assembly.GetManifestResourceNames().Where(n => n.EndsWith(".ttf", StringComparison.OrdinalIgnoreCase)))
            {
                byte[] bytes;
                using (var stream = assembly.GetManifestResourceStream(name))
                using (var buffer = new MemoryStream())
                {
                    stream.CopyTo(buffer);
                    bytes = buffer.ToArray();
                }
                var memory = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, memory, bytes.Length);
                FontMemory.Add(memory);
                Fonts.AddMemoryFont(memory, bytes.Length);
                uint count = 0;
                AddFontMemResourceEx(memory, (uint)bytes.Length, IntPtr.Zero, ref count);
            }
        }

        public static FontFamily Family(string weight)
        {
            var wanted = weight == "" ? "Geist" : "Geist " + weight;
            return Fonts.Families.FirstOrDefault(f => f.Name == wanted) ?? new FontFamily("Segoe UI");
        }

        public static Font Font(string weight, float px) => new Font(Family(weight), F(px), FontStyle.Regular, GraphicsUnit.Pixel);

        public static void Smooth(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        }

        public static GraphicsPath Round(RectangleF r, float rad)
        {
            var p = new GraphicsPath();
            rad = Math.Min(rad, Math.Min(r.Width, r.Height) / 2f);
            if (rad <= 0.5f) { p.AddRectangle(r); return p; }
            float d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static Color Mix(Color a, Color b, float t)
        {
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            return Color.FromArgb((int)(a.A + (b.A - a.A) * t), (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }

        public static Color Fade(Color c, float t) => Color.FromArgb((int)(c.A * (t < 0 ? 0 : t > 1 ? 1 : t)), c);

        public static float Ease(float t) => 1 - (1 - t) * (1 - t) * (1 - t);

        public static float Approach(float v, float target, float step) =>
            v < target ? Math.Min(target, v + step) : Math.Max(target, v - step);

        public static void Wordmark(Graphics g, string text, Color dot, float em, PointF at, float alpha)
        {
            var family = Family("SemiBold");
            float x = at.X, spacing = -0.05f * em;
            using (var format = (StringFormat)StringFormat.GenericTypographic.Clone())
            using (var measure = new Font(family, em, FontStyle.Regular, GraphicsUnit.Pixel))
            using (var path = new GraphicsPath())
            {
                format.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
                foreach (char c in text)
                {
                    path.AddString(c.ToString(), family, (int)FontStyle.Regular, em, new PointF(x, at.Y), format);
                    x += g.MeasureString(c.ToString(), measure, PointF.Empty, format).Width + spacing;
                }
                using (var b = new SolidBrush(Fade(Text, alpha))) g.FillPath(b, path);
            }
            using (var dotPath = new GraphicsPath())
            {
                dotPath.AddString(".", family, (int)FontStyle.Regular, em, new PointF(x, at.Y), format: StringFormat.GenericTypographic);
                using (var b = new SolidBrush(Fade(dot, alpha))) g.FillPath(b, dotPath);
            }
        }

        public static void Apple(Graphics g, RectangleF r, Color color)
        {
            var state = g.Save();
            g.TranslateTransform(r.X, r.Y);
            g.ScaleTransform(r.Width / 20f, r.Height / 20f);
            using (var pen = new Pen(color, 1.6f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            using (var fill = new SolidBrush(color))
            using (var body = new GraphicsPath())
            {
                body.AddBezier(10f, 6.3f, 9f, 5.5f, 7.5f, 5.1f, 6.3f, 5.5f);
                body.AddBezier(6.3f, 5.5f, 4.1f, 6.2f, 2.9f, 8.5f, 3.2f, 11.3f);
                body.AddBezier(3.2f, 11.3f, 3.5f, 14.2f, 5.2f, 17.6f, 7.3f, 17.9f);
                body.AddBezier(7.3f, 17.9f, 8.3f, 18.1f, 9f, 17.4f, 10f, 17.4f);
                body.AddBezier(10f, 17.4f, 11f, 17.4f, 11.7f, 18.1f, 12.7f, 17.9f);
                body.AddBezier(12.7f, 17.9f, 14.8f, 17.6f, 16.5f, 14.2f, 16.8f, 11.3f);
                body.AddBezier(16.8f, 11.3f, 17.1f, 8.5f, 15.9f, 6.2f, 13.7f, 5.5f);
                body.AddBezier(13.7f, 5.5f, 12.5f, 5.1f, 11f, 5.5f, 10f, 6.3f);
                body.CloseFigure();
                g.DrawPath(pen, body);
                g.DrawBezier(pen, 10f, 6.2f, 10f, 4.8f, 10.3f, 3.7f, 11f, 2.8f);
                using (var leaf = new GraphicsPath())
                {
                    leaf.AddBezier(11.5f, 4.6f, 11.9f, 2.8f, 13.6f, 1.8f, 15.9f, 2f);
                    leaf.AddBezier(15.9f, 2f, 15.6f, 4.1f, 13.9f, 5.3f, 11.5f, 4.6f);
                    leaf.CloseFigure();
                    g.FillPath(fill, leaf);
                }
            }
            g.Restore(state);
        }

        [DllImport("gdi32.dll")]
        static extern IntPtr AddFontMemResourceEx(IntPtr font, uint size, IntPtr reserved, ref uint fonts);
    }
}
