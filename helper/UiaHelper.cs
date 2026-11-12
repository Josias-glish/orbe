// Lector de pantalla de Orbe: usa UI Automation de Windows para leer la ventana en la que estabas.
// Es un proceso persistente que habla con Orbe por stdin/stdout, con un objeto JSON por línea:
//   -> {"id":1,"op":"ventana"|"seleccion"|"contenido"|"ping","hwnd":123,"max":8000}
//   <- {"id":1,"ok":true,"datos":{...}}  o  {"id":1,"ok":false,"error":"..."}
// Al arrancar escribe {"tipo":"listo"}. No lee nada por su cuenta: solo recuerda cuál fue la última
// ventana externa en primer plano (un identificador, sin su contenido) y responde a lo que Orbe pide.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace Orbe
{
    internal static class Win32
    {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
        public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr valor);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        // Entrada simulada (SendInput).
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public UNION u; }
        [StructLayout(LayoutKind.Explicit)]
        public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
        [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);

        // Ganchos de bajo nivel: ven el ratón y el teclado reales (lo simulado lleva la marca «inyectado»).
        public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint hilo);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string nombre);
        [StructLayout(LayoutKind.Sequential)]
        public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLL { public uint vk, scan, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MSLL { public POINT pt; public uint data, flags, time; public IntPtr extra; }
    }

    /// Resultado parcial de una operación que puede agotar su tiempo: lo ya leído no se pierde.
    internal class Parcial
    {
        readonly StringBuilder texto = new StringBuilder();
        public string Metodo;
        /// Se agotó el tiempo: el trabajo en curso debe parar en cuanto pueda.
        public volatile bool Cancelado;
        /// Se alcanzó el máximo de caracteres pedido.
        public volatile bool Tope;
        /// Mensaje del error que interrumpió el trabajo, si lo hubo (se devuelve a Orbe para diagnosticar).
        public volatile string Error;

        public int Longitud { get { lock (texto) { return texto.Length; } } }
        public void Anadir(string s) { lock (texto) { texto.Append(s); } }
        public override string ToString() { lock (texto) { return texto.ToString(); } }
    }

    public static class Servidor
    {
        internal static int pidOrbe;
        static IntPtr ultimaExterna = IntPtr.Zero;
        static readonly object cerrojo = new object();
        static readonly object cerrojoSalida = new object();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 32 };
        static TextWriter salida;

        // Ventanas del propio sistema que nunca son «la ventana del usuario».
        internal static readonly HashSet<string> ClasesSistema = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "NotifyIconOverflowWindow",
            "TaskListThumbnailWnd", "MultitaskingViewFrame", "ForegroundStaging", "XamlExplorerHostIslandWindow",
            "TopLevelWindowForOverflowXamlIsland"
        };
        internal static readonly HashSet<string> ProcesosSistema = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "SearchHost", "SearchApp", "StartMenuExperienceHost", "ShellExperienceHost", "TextInputHost",
            "LockApp", "ShellHost", "dwm", "LogonUI"
        };
        static readonly HashSet<string> Navegadores = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "chrome", "msedge", "firefox", "brave", "opera", "opera_gx", "vivaldi", "chromium", "arc", "iexplore"
        };
        // Chromium (Chrome, Edge, apps Electron) y Firefox construyen su árbol de accesibilidad la primera vez
        // que alguien se lo pide; hay que darles un momento antes de dar la ventana por vacía.
        static readonly HashSet<string> ClasesWeb = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "Chrome_WidgetWin_1", "MozillaWindowClass"
        };
        static readonly Regex PareceUrl = new Regex(@"^(https?|file|ftp|about|chrome|edge|brave|view-source):", RegexOptions.IgnoreCase);

        // -------------------------------------------------------------------------------------
        // Bucle principal
        // -------------------------------------------------------------------------------------

        public static void Ejecutar(int pid)
        {
            pidOrbe = pid;
            // Coordenadas en píxeles físicos para todo (UI Automation, ventanas y SendInput), como espera Orbe.
            try { if (!Win32.SetProcessDpiAwarenessContext(new IntPtr(-4))) Win32.SetProcessDPIAware(); } catch { try { Win32.SetProcessDPIAware(); } catch { } }
            salida = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            var entrada = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));

            var seguidor = new Thread(Seguir) { IsBackground = true, Name = "seguidor-primer-plano" };
            seguidor.Start();

            Escribir(new Dictionary<string, object> { { "tipo", "listo" }, { "version", 1 } });

            string linea;
            while ((linea = entrada.ReadLine()) != null)
            {
                if (linea.Trim().Length == 0) continue;
                string peticion = linea;
                // Cada petición en su propio hilo: una aplicación colgada no bloquea las siguientes.
                ThreadPool.QueueUserWorkItem(_ => Atender(peticion));
            }
            // stdin cerrado: Orbe ha terminado, salimos.
        }

        internal static void Escribir(Dictionary<string, object> mensaje)
        {
            string texto = json.Serialize(mensaje);
            lock (cerrojoSalida) { salida.WriteLine(texto); }
        }

        static void Atender(string linea)
        {
            object id = null;
            try
            {
                var peticion = json.DeserializeObject(linea) as Dictionary<string, object>;
                if (peticion == null) return;
                peticion.TryGetValue("id", out id);
                string op = Texto(peticion, "op");
                Dictionary<string, object> datos;
                switch (op)
                {
                    case "ping": datos = new Dictionary<string, object> { { "pong", true } }; break;
                    case "ventana": datos = OpVentana(peticion); break;
                    case "seleccion": datos = OpSeleccion(peticion); break;
                    case "contenido": datos = OpContenido(peticion); break;
                    case "elementos": datos = Control.Elementos(peticion); break;
                    case "actuar": datos = Control.Actuar(peticion); break;
                    case "ventanas": datos = Control.Ventanas(); break;
                    case "enfocar": datos = Control.Enfocar(peticion); break;
                    case "punto": datos = Control.Punto(peticion); break;
                    case "clic": datos = Control.Clic(peticion); break;
                    case "teclas": datos = Control.Teclas(peticion); break;
                    case "texto": datos = Control.Texto(peticion); break;
                    case "vigilar": datos = Control.Vigilar(peticion); break;
                    default: throw new InvalidOperationException("Operación desconocida: " + op);
                }
                Escribir(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "datos", datos } });
            }
            catch (Exception e)
            {
                Escribir(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", e.GetType().Name + ": " + e.Message } });
            }
        }

        internal static string Texto(Dictionary<string, object> d, string clave)
        {
            object v;
            return d.TryGetValue(clave, out v) && v != null ? v.ToString() : null;
        }

        internal static long? Entero(Dictionary<string, object> d, string clave)
        {
            object v;
            if (!d.TryGetValue(clave, out v) || v == null) return null;
            try { return Convert.ToInt64(v); } catch { return null; }
        }

        // -------------------------------------------------------------------------------------
        // Seguimiento de la ventana externa
        // -------------------------------------------------------------------------------------

        static void Seguir()
        {
            IntPtr anterior = IntPtr.Zero;
            while (true)
            {
                try
                {
                    IntPtr h = Win32.GetForegroundWindow();
                    if (h != IntPtr.Zero && h != anterior)
                    {
                        anterior = h;
                        if (EsVentanaExterna(h)) lock (cerrojo) { ultimaExterna = h; }
                    }
                }
                catch { }
                Thread.Sleep(250);
            }
        }

        internal static string ClaseDe(IntPtr h)
        {
            var sb = new StringBuilder(256);
            Win32.GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        internal static string TituloDe(IntPtr h)
        {
            var sb = new StringBuilder(512);
            Win32.GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        internal static string NombreProceso(int pid)
        {
            try { return Process.GetProcessById(pid).ProcessName; } catch { return null; }
        }

        /// ¿Es una ventana de usuario (no de Orbe, ni de la barra de tareas, ni del menú Inicio)?
        internal static bool EsVentanaExterna(IntPtr h)
        {
            if (h == IntPtr.Zero || !Win32.IsWindow(h) || !Win32.IsWindowVisible(h) || Win32.IsIconic(h)) return false;
            int pid;
            Win32.GetWindowThreadProcessId(h, out pid);
            if (pid == 0 || pid == pidOrbe || pid == Process.GetCurrentProcess().Id) return false;
            if (ClasesSistema.Contains(ClaseDe(h))) return false;
            string proceso = NombreProceso(pid);
            if (proceso != null && ProcesosSistema.Contains(proceso)) return false;
            return true;
        }

        /// La ventana a leer: la que pide Orbe; si no, la que está en primer plano si es externa; si no, la última que lo estuvo.
        internal static IntPtr ResolverObjetivo(Dictionary<string, object> peticion, out bool primerPlano)
        {
            primerPlano = false;
            long? pedido = Entero(peticion, "hwnd");
            IntPtr fg = Win32.GetForegroundWindow();
            if (pedido.HasValue)
            {
                IntPtr h = new IntPtr(pedido.Value);
                if (!Win32.IsWindow(h)) throw new InvalidOperationException("La ventana ya no existe.");
                primerPlano = (h == fg);
                return h;
            }
            if (EsVentanaExterna(fg))
            {
                primerPlano = true;
                lock (cerrojo) { ultimaExterna = fg; }
                return fg;
            }
            IntPtr ultima;
            lock (cerrojo) { ultima = ultimaExterna; }
            if (ultima != IntPtr.Zero && Win32.IsWindow(ultima)) return ultima;
            return IntPtr.Zero;
        }

        // -------------------------------------------------------------------------------------
        // Operaciones
        // -------------------------------------------------------------------------------------

        internal static Dictionary<string, object> OpVentana(Dictionary<string, object> peticion)
        {
            bool primerPlano;
            IntPtr h = ResolverObjetivo(peticion, out primerPlano);
            if (h == IntPtr.Zero) return new Dictionary<string, object> { { "ventana", null } };

            int pid;
            Win32.GetWindowThreadProcessId(h, out pid);
            string proceso = NombreProceso(pid) ?? "desconocido";
            string aplicacion = proceso;
            bool restringida = false;
            try
            {
                var info = Process.GetProcessById(pid).MainModule.FileVersionInfo;
                if (!string.IsNullOrWhiteSpace(info.FileDescription)) aplicacion = info.FileDescription.Trim();
            }
            catch { restringida = true; } // normalmente: proceso elevado o protegido

            bool esNavegador = Navegadores.Contains(proceso);
            string url = null;
            string barra = null;
            if (esNavegador)
            {
                var direcciones = Limitar<string[]>(4000, new Parcial(), () => ObtenerDirecciones(h));
                if (direcciones != null) { url = direcciones[0]; barra = direcciones[1]; }
            }

            // Posición en píxeles de pantalla: sirve para saber en qué monitor está (captura de respaldo).
            Dictionary<string, object> rect = null;
            Win32.RECT r;
            if (Win32.GetWindowRect(h, out r))
            {
                rect = new Dictionary<string, object> {
                    { "x", r.Left }, { "y", r.Top }, { "ancho", r.Right - r.Left }, { "alto", r.Bottom - r.Top }
                };
            }

            var ventana = new Dictionary<string, object> {
                { "hwnd", h.ToInt64() },
                { "pid", pid },
                { "proceso", proceso },
                { "aplicacion", aplicacion },
                { "titulo", TituloDe(h) },
                { "esNavegador", esNavegador },
                { "url", url },
                { "barra", barra },
                { "primerPlano", primerPlano },
                { "restringida", restringida },
                { "rect", rect }
            };
            return new Dictionary<string, object> { { "ventana", ventana } };
        }

        static Dictionary<string, object> OpSeleccion(Dictionary<string, object> peticion)
        {
            bool primerPlano;
            IntPtr h = ResolverObjetivo(peticion, out primerPlano);
            int max = (int)(Entero(peticion, "max") ?? 8000);
            if (h == IntPtr.Zero) return new Dictionary<string, object> { { "texto", null }, { "metodo", null } };

            var parcial = new Parcial();
            Limitar<object>(2500, parcial, () => BuscarSeleccion(h, primerPlano, max, parcial));

            string texto = parcial.ToString();
            return new Dictionary<string, object> {
                { "texto", texto.Length > 0 ? texto : null },
                { "metodo", texto.Length > 0 ? parcial.Metodo : null },
                { "error", parcial.Error }
            };
        }

        static Dictionary<string, object> OpContenido(Dictionary<string, object> peticion)
        {
            bool primerPlano;
            IntPtr h = ResolverObjetivo(peticion, out primerPlano);
            int max = (int)(Entero(peticion, "max") ?? 24000);
            // «fuera»: 1 = no descartar los elementos que UI Automation marca como fuera de pantalla (solo pruebas).
            bool incluirFuera = (Entero(peticion, "fuera") ?? 0) == 1;
            if (h == IntPtr.Zero) return new Dictionary<string, object> { { "texto", null }, { "metodo", null }, { "parcial", false } };

            var parcial = new Parcial();
            Limitar<object>(5000, parcial, () => LeerContenido(h, max, incluirFuera, parcial));

            string texto = parcial.ToString();
            return new Dictionary<string, object> {
                { "texto", texto.Length > 0 ? texto : null },
                { "metodo", texto.Length > 0 ? parcial.Metodo : null },
                { "parcial", parcial.Cancelado || parcial.Tope },
                { "error", parcial.Error }
            };
        }

        // -------------------------------------------------------------------------------------
        // Lectura con UI Automation
        // -------------------------------------------------------------------------------------

        /// Ejecuta `trabajo` con un tiempo máximo. Si se agota (una app colgada), marca el parcial como
        /// cancelado y devuelve null; UI Automation no se puede abortar, pero el trabajo para en cuanto vuelva.
        internal static T Limitar<T>(int milisegundos, Parcial parcial, Func<T> trabajo) where T : class
        {
            var tarea = Task.Factory.StartNew(trabajo, TaskCreationOptions.LongRunning);
            try
            {
                if (tarea.Wait(milisegundos)) return tarea.Result;
            }
            catch (AggregateException e)
            {
                var interno = e.InnerException ?? e;
                parcial.Error = interno.GetType().Name + ": " + interno.Message;
                return null;
            }
            parcial.Cancelado = true;
            return null;
        }

        static string SeleccionDe(AutomationElement e, int max)
        {
            try
            {
                object p;
                if (!e.TryGetCurrentPattern(TextPattern.Pattern, out p)) return null;
                var rangos = ((TextPattern)p).GetSelection();
                if (rangos == null || rangos.Length == 0) return null;
                var sb = new StringBuilder();
                foreach (var r in rangos)
                {
                    if (sb.Length >= max) break;
                    string t = r.GetText(max - sb.Length);
                    if (!string.IsNullOrEmpty(t)) { if (sb.Length > 0) sb.Append("\n"); sb.Append(t); }
                }
                string resultado = sb.ToString();
                return resultado.Trim().Length > 0 ? resultado : null;
            }
            catch { return null; }
        }

        static object BuscarSeleccion(IntPtr h, bool primerPlano, int max, Parcial parcial)
        {
            // 1) En primer plano, el elemento con el foco (o alguno de sus ascendientes) suele tener la selección.
            if (primerPlano)
            {
                AutomationElement foco = null;
                try { foco = AutomationElement.FocusedElement; } catch { }
                int nivel = 0;
                for (var actual = foco; actual != null && nivel < 12 && !parcial.Cancelado; nivel++)
                {
                    string t = SeleccionDe(actual, max);
                    if (!string.IsNullOrEmpty(t)) { parcial.Anadir(t); parcial.Metodo = "foco"; return null; }
                    try { if (actual.Current.NativeWindowHandle == (int)h.ToInt64()) break; } catch { }
                    try { actual = TreeWalker.ControlViewWalker.GetParent(actual); } catch { break; }
                }
            }
            // 2) Si no, se busca en la ventana un control de texto con algo seleccionado
            //    (la selección se conserva aunque la ventana haya perdido el foco).
            var raiz = AutomationElement.FromHandle(h);
            // En navegadores se espera a que activen su accesibilidad y se mira primero el documento web.
            if (EsVentanaWeb(h))
            {
                foreach (var doc in DocumentosListos(raiz, true, parcial))
                {
                    if (parcial.Cancelado) break;
                    string t = SeleccionDe(doc, max);
                    if (!string.IsNullOrEmpty(t)) { parcial.Anadir(t); parcial.Metodo = "busqueda"; return null; }
                }
            }
            var candidatos = raiz.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.IsTextPatternAvailableProperty, true));
            int revisados = 0;
            foreach (AutomationElement e in candidatos)
            {
                if (parcial.Cancelado || revisados++ >= 40) break;
                string t = SeleccionDe(e, max);
                if (!string.IsNullOrEmpty(t)) { parcial.Anadir(t); parcial.Metodo = "busqueda"; return null; }
            }
            return null;
        }

        /// Devuelve { url del documento web, texto de la barra de direcciones }. Cualquiera puede ser null.
        static string[] ObtenerDirecciones(IntPtr h)
        {
            var raiz = AutomationElement.FromHandle(h);
            string url = null;
            var doc = ElegirDocumento(raiz, EsVentanaWeb(h), new Parcial());
            if (doc != null) url = ValorUrl(doc);

            // La barra de direcciones es el primer campo de edición del navegador; muestra la dirección sin «https://».
            string barra = null;
            var campos = raiz.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            int n = 0;
            foreach (AutomationElement c in campos)
            {
                if (n++ > 12) break;
                try
                {
                    object p;
                    if (!c.TryGetCurrentPattern(ValuePattern.Pattern, out p)) continue;
                    string v = ((ValuePattern)p).Current.Value;
                    if (!string.IsNullOrWhiteSpace(v) && v.IndexOf(' ') < 0 && v.Length < 2048) { barra = v; break; }
                }
                catch { }
            }
            return new string[] { url, barra };
        }

        internal static bool EsVentanaWeb(IntPtr h)
        {
            return ClasesWeb.Contains(ClaseDe(h));
        }

        static double AreaDe(AutomationElement e)
        {
            try
            {
                var r = e.Current.BoundingRectangle;
                if (r.IsEmpty || double.IsInfinity(r.Width) || double.IsInfinity(r.Height)) return 0;
                return r.Width * r.Height;
            }
            catch { return 0; }
        }

        /// Documentos web que ya exponen su contenido. En navegadores se espera a que activen la accesibilidad.
        internal static List<AutomationElement> DocumentosListos(AutomationElement raiz, bool esperar, Parcial parcial)
        {
            int intentos = esperar ? 9 : 1;
            for (int i = 0; i < intentos && !parcial.Cancelado; i++)
            {
                var resultado = new List<AutomationElement>();
                var docs = raiz.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
                foreach (AutomationElement d in docs)
                {
                    try
                    {
                        object p;
                        if (d.TryGetCurrentPattern(TextPattern.Pattern, out p) || d.TryGetCurrentPattern(ValuePattern.Pattern, out p)) resultado.Add(d);
                    }
                    catch { }
                }
                if (resultado.Count > 0) return resultado;
                if (!esperar) break;
                Thread.Sleep(300);
            }
            return new List<AutomationElement>();
        }

        /// El documento principal: el de mayor superficie visible (los avisos y ventanas emergentes son más pequeños).
        static AutomationElement ElegirDocumento(AutomationElement raiz, bool esperar, Parcial parcial)
        {
            AutomationElement mejor = null;
            double mejorArea = -1;
            foreach (var d in DocumentosListos(raiz, esperar, parcial))
            {
                double area = AreaDe(d);
                if (area > mejorArea) { mejor = d; mejorArea = area; }
            }
            return mejor;
        }

        static string ValorUrl(AutomationElement e)
        {
            if (e == null) return null;
            try
            {
                object p;
                if (!e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) return null;
                string v = ((ValuePattern)p).Current.Value;
                return !string.IsNullOrEmpty(v) && PareceUrl.IsMatch(v) ? v : null;
            }
            catch { return null; }
        }

        static object LeerContenido(IntPtr h, int max, bool incluirFuera, Parcial parcial)
        {
            var raiz = AutomationElement.FromHandle(h);

            // 1) Documento principal con TextPattern (páginas web, editores, procesadores de texto): rápido y limpio.
            var principal = ElegirDocumento(raiz, EsVentanaWeb(h), parcial);
            if (principal != null)
            {
                string t = TextoDeDocumento(principal, max);
                if (t != null && t.Trim().Length > 0)
                {
                    parcial.Anadir(t);
                    parcial.Metodo = "documento";
                    parcial.Tope = t.Length >= max;
                    return null;
                }
            }

            // 2) Cualquier control con TextPattern (cuadros de texto grandes, consolas, editores).
            if (!parcial.Cancelado)
            {
                var conTexto = raiz.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.IsTextPatternAvailableProperty, true));
                string mejor = MejorTexto(conTexto, max, parcial, 25);
                if (mejor != null)
                {
                    parcial.Anadir(mejor);
                    parcial.Metodo = "texto";
                    parcial.Tope = mejor.Length >= max;
                    return null;
                }
            }

            // 3) Recorrido del árbol: nombres y valores de los controles visibles, en orden de aparición.
            if (!parcial.Cancelado) RecorrerArbol(raiz, max, incluirFuera, parcial);
            return null;
        }

        /// El texto más largo entre los primeros `limite` elementos que tengan TextPattern.
        static string MejorTexto(AutomationElementCollection elementos, int max, Parcial parcial, int limite)
        {
            string mejor = null;
            int vistos = 0;
            foreach (AutomationElement e in elementos)
            {
                if (parcial.Cancelado || vistos++ >= limite) break;
                string t = TextoDeDocumento(e, max);
                if (t != null && t.Trim().Length > 0 && (mejor == null || t.Length > mejor.Length)) mejor = t;
            }
            return mejor;
        }

        static string TextoDeDocumento(AutomationElement e, int max)
        {
            try
            {
                object p;
                if (!e.TryGetCurrentPattern(TextPattern.Pattern, out p)) return null;
                return ((TextPattern)p).DocumentRange.GetText(max);
            }
            catch { return null; }
        }

        static void RecorrerArbol(AutomationElement raiz, int max, bool incluirFuera, Parcial parcial)
        {
            ControlType[] tipos = {
                ControlType.Text, ControlType.Edit, ControlType.Hyperlink, ControlType.ListItem, ControlType.DataItem,
                ControlType.TreeItem, ControlType.TabItem, ControlType.MenuItem, ControlType.Button, ControlType.CheckBox,
                ControlType.RadioButton, ControlType.ComboBox, ControlType.Header, ControlType.HeaderItem
            };
            var condiciones = new Condition[tipos.Length];
            for (int i = 0; i < tipos.Length; i++)
                condiciones[i] = new PropertyCondition(AutomationElement.ControlTypeProperty, tipos[i]);

            // Los controles de la barra de título (minimizar, cerrar…) no son contenido: se descartan.
            var enBarraDeTitulo = new HashSet<string>();
            try
            {
                var barras = raiz.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TitleBar));
                if (barras.Count <= 3)
                {
                    foreach (AutomationElement barra in barras)
                        foreach (AutomationElement hijo in barra.FindAll(TreeScope.Descendants, Condition.TrueCondition))
                            enBarraDeTitulo.Add(string.Join(",", hijo.GetRuntimeId()));
                }
            }
            catch { }

            var cache = new CacheRequest { TreeScope = TreeScope.Element };
            cache.Add(AutomationElement.NameProperty);
            cache.Add(AutomationElement.IsOffscreenProperty);
            cache.Add(ValuePattern.Pattern);
            cache.Add(ValuePattern.ValueProperty);

            using (cache.Activate())
            {
                var todos = raiz.FindAll(TreeScope.Descendants, new OrCondition(condiciones));
                string ultimaLinea = null;
                int contados = 0;
                foreach (AutomationElement e in todos)
                {
                    if (parcial.Cancelado || contados++ >= 6000) break;
                    try
                    {
                        if (!incluirFuera && e.Cached.IsOffscreen) continue;
                        if (enBarraDeTitulo.Count > 0 && enBarraDeTitulo.Contains(string.Join(",", e.GetRuntimeId()))) continue;
                        string linea = null;
                        object pv;
                        if (e.TryGetCachedPattern(ValuePattern.Pattern, out pv))
                        {
                            string v = ((ValuePattern)pv).Cached.Value;
                            if (!string.IsNullOrWhiteSpace(v)) linea = v;
                        }
                        if (string.IsNullOrWhiteSpace(linea)) linea = e.Cached.Name;
                        if (string.IsNullOrWhiteSpace(linea)) continue;
                        linea = linea.Trim();
                        if (linea == ultimaLinea) continue; // el mismo texto repetido en elementos contiguos
                        ultimaLinea = linea;
                        if (parcial.Longitud + linea.Length + 1 > max) { parcial.Tope = true; break; }
                        parcial.Anadir(linea + "\n");
                    }
                    catch { }
                }
            }
            if (parcial.Longitud > 0) parcial.Metodo = "arbol";
        }
    }

    /// Control del PC (Etapa 8): lista numerada de elementos, acciones por accesibilidad y, de respaldo, ratón y
    /// teclado simulados. Las reglas de seguridad (apps bloqueadas, confirmaciones) las aplica Orbe; aquí quedan las
    /// que no se pueden saltar: nunca se escribe en campos de contraseña o de códigos, ni se lee su valor.
    public static class Control
    {
        static readonly object cerrojoLista = new object();
        static List<AutomationElement> lista = new List<AutomationElement>();
        static IntPtr listaHwnd = IntPtr.Zero;
        const int MaxElementos = 250;

        static readonly Regex CampoSecreto = new Regex(@"contrase|password|passwd|passcode|clave|c[oó]digo|\bcode\b|otp|\bpin\b|cvv|cvc|verificaci|token|2fa|seguridad", RegexOptions.IgnoreCase);

        static readonly ControlType[] Interactivos = {
            ControlType.Button, ControlType.SplitButton, ControlType.Edit, ControlType.ComboBox, ControlType.CheckBox,
            ControlType.RadioButton, ControlType.Hyperlink, ControlType.MenuItem, ControlType.TabItem, ControlType.ListItem,
            ControlType.TreeItem, ControlType.DataItem, ControlType.Slider, ControlType.Spinner
        };

        static readonly Dictionary<string, string> Tipos = new Dictionary<string, string> {
            { "Button", "botón" }, { "SplitButton", "botón" }, { "Edit", "campo" }, { "ComboBox", "desplegable" },
            { "CheckBox", "casilla" }, { "RadioButton", "opción" }, { "Hyperlink", "enlace" }, { "MenuItem", "menú" },
            { "TabItem", "pestaña" }, { "ListItem", "elemento" }, { "TreeItem", "elemento" }, { "DataItem", "fila" },
            { "Slider", "control deslizante" }, { "Spinner", "número" }
        };

        static bool EsSecreto(AutomationElement e)
        {
            try
            {
                if (e.Current.IsPassword) return true;
                return CampoSecreto.IsMatch((e.Current.Name ?? "") + " " + (e.Current.AutomationId ?? ""));
            }
            catch { return true; } // si no se puede comprobar, no se escribe
        }

        static Dictionary<string, object> Rect(System.Windows.Rect r)
        {
            if (r.IsEmpty || double.IsInfinity(r.Width)) return null;
            return new Dictionary<string, object> { { "x", (int)r.X }, { "y", (int)r.Y }, { "ancho", (int)r.Width }, { "alto", (int)r.Height } };
        }

        static IntPtr Hwnd(Dictionary<string, object> peticion)
        {
            long? h = Servidor.Entero(peticion, "hwnd");
            if (!h.HasValue || !Win32.IsWindow(new IntPtr(h.Value))) throw new InvalidOperationException("Esa ventana ya no existe: vuelve a mirar con pc_ver.");
            return new IntPtr(h.Value);
        }

        // ---------------------------------------------------------------------------------
        // Ver
        // ---------------------------------------------------------------------------------

        public static Dictionary<string, object> Elementos(Dictionary<string, object> peticion)
        {
            bool primerPlano;
            IntPtr h = Servidor.ResolverObjetivo(peticion, out primerPlano);
            if (h == IntPtr.Zero) return new Dictionary<string, object> { { "ventana", null } };
            var info = (Dictionary<string, object>)Servidor.OpVentana(new Dictionary<string, object> { { "hwnd", h.ToInt64() } })["ventana"];

            var nuevos = new List<AutomationElement>();
            var salida = new List<object>();
            var parcial = new Parcial();
            Servidor.Limitar<object>(6000, parcial, () =>
            {
                var raiz = AutomationElement.FromHandle(h);
                if (Servidor.EsVentanaWeb(h)) Servidor.DocumentosListos(raiz, true, parcial);
                var condiciones = new Condition[Interactivos.Length];
                for (int i = 0; i < Interactivos.Length; i++) condiciones[i] = new PropertyCondition(AutomationElement.ControlTypeProperty, Interactivos[i]);
                var cache = new CacheRequest { TreeScope = TreeScope.Element };
                cache.Add(AutomationElement.NameProperty);
                cache.Add(AutomationElement.ControlTypeProperty);
                cache.Add(AutomationElement.IsEnabledProperty);
                cache.Add(AutomationElement.IsOffscreenProperty);
                cache.Add(AutomationElement.BoundingRectangleProperty);
                cache.Add(AutomationElement.IsPasswordProperty);
                cache.Add(AutomationElement.HasKeyboardFocusProperty);
                cache.Add(AutomationElement.AutomationIdProperty);
                cache.Add(ValuePattern.Pattern);
                cache.Add(ValuePattern.ValueProperty);
                cache.Add(TogglePattern.Pattern);
                cache.Add(TogglePattern.ToggleStateProperty);
                cache.Add(ExpandCollapsePattern.Pattern);
                cache.Add(ExpandCollapsePattern.ExpandCollapseStateProperty);
                cache.Add(SelectionItemPattern.Pattern);
                cache.Add(SelectionItemPattern.IsSelectedProperty);
                using (cache.Activate())
                {
                    var todos = raiz.FindAll(TreeScope.Descendants, new OrCondition(condiciones));
                    foreach (AutomationElement e in todos)
                    {
                        if (parcial.Cancelado || nuevos.Count >= MaxElementos) break;
                        try
                        {
                            if (e.Cached.IsOffscreen) continue;
                            var rect = Rect(e.Cached.BoundingRectangle);
                            if (rect == null) continue;
                            string nombre = (e.Cached.Name ?? "").Trim();
                            string tipo = e.Cached.ControlType.ProgrammaticName.Replace("ControlType.", "");
                            bool secreto = e.Cached.IsPassword || CampoSecreto.IsMatch(nombre + " " + (e.Cached.AutomationId ?? ""));
                            string valor = null;
                            object p;
                            if (!secreto && e.TryGetCachedPattern(ValuePattern.Pattern, out p))
                            {
                                valor = ((ValuePattern)p).Cached.Value;
                                if (valor != null && valor.Length > 120) valor = valor.Substring(0, 120) + "…";
                            }
                            if (nombre.Length == 0 && string.IsNullOrEmpty(valor) && tipo != "Edit") continue;
                            var estados = new List<string>();
                            if (!e.Cached.IsEnabled) estados.Add("desactivado");
                            if (e.Cached.HasKeyboardFocus) estados.Add("con el foco");
                            if (secreto) estados.Add("contraseña o código: no se escribe aquí");
                            if (e.TryGetCachedPattern(TogglePattern.Pattern, out p))
                                estados.Add(((TogglePattern)p).Cached.ToggleState == ToggleState.On ? "marcado" : "sin marcar");
                            if (e.TryGetCachedPattern(ExpandCollapsePattern.Pattern, out p))
                            {
                                var ec = ((ExpandCollapsePattern)p).Cached.ExpandCollapseState;
                                if (ec == ExpandCollapseState.Expanded) estados.Add("desplegado");
                                else if (ec == ExpandCollapseState.Collapsed) estados.Add("plegado");
                            }
                            if (e.TryGetCachedPattern(SelectionItemPattern.Pattern, out p) && ((SelectionItemPattern)p).Cached.IsSelected) estados.Add("seleccionado");
                            nuevos.Add(e);
                            string t;
                            salida.Add(new Dictionary<string, object> {
                                { "n", nuevos.Count }, { "tipo", Tipos.TryGetValue(tipo, out t) ? t : tipo.ToLowerInvariant() },
                                { "nombre", nombre }, { "valor", valor }, { "estado", string.Join(", ", estados) }, { "rect", rect }
                            });
                        }
                        catch { }
                    }
                }
                return null;
            });
            lock (cerrojoLista) { lista = nuevos; listaHwnd = h; }
            return new Dictionary<string, object> {
                { "ventana", info }, { "elementos", salida }, { "parcial", parcial.Cancelado || nuevos.Count >= MaxElementos }, { "error", parcial.Error }
            };
        }

        public static Dictionary<string, object> Ventanas()
        {
            var ventanas = new List<object>();
            Win32.EnumWindows((h, _) =>
            {
                if (ventanas.Count >= 40) return false;
                if (!Win32.IsWindowVisible(h) || Win32.GetWindow(h, 4) != IntPtr.Zero) return true; // 4 = GW_OWNER
                if ((Win32.GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
                string titulo = Servidor.TituloDe(h);
                if (titulo.Trim().Length == 0 || Servidor.ClasesSistema.Contains(Servidor.ClaseDe(h))) return true;
                int pid;
                Win32.GetWindowThreadProcessId(h, out pid);
                if (pid == Servidor.pidOrbe || pid == Process.GetCurrentProcess().Id) return true;
                string proceso = Servidor.NombreProceso(pid) ?? "desconocido";
                if (Servidor.ProcesosSistema.Contains(proceso)) return true;
                ventanas.Add(new Dictionary<string, object> {
                    { "hwnd", h.ToInt64() }, { "titulo", titulo }, { "proceso", proceso }, { "minimizada", Win32.IsIconic(h) }
                });
                return true;
            }, IntPtr.Zero);
            return new Dictionary<string, object> { { "ventanas", ventanas } };
        }

        // ---------------------------------------------------------------------------------
        // Actuar por accesibilidad
        // ---------------------------------------------------------------------------------

        static AutomationElement Elemento(Dictionary<string, object> peticion, IntPtr h)
        {
            int n = (int)(Servidor.Entero(peticion, "n") ?? 0);
            lock (cerrojoLista)
            {
                if (listaHwnd != h || n < 1 || n > lista.Count) throw new InvalidOperationException("No tengo el elemento " + n + " de esa ventana: vuelve a mirar con pc_ver.");
                return lista[n - 1];
            }
        }

        static T Patron<T>(AutomationElement e, AutomationPattern patron) where T : class
        {
            object p;
            return e.TryGetCurrentPattern(patron, out p) ? p as T : null;
        }

        public static Dictionary<string, object> Actuar(Dictionary<string, object> peticion)
        {
            IntPtr h = Hwnd(peticion);
            string accion = Servidor.Texto(peticion, "accion");
            AutomationElement e = accion == "desplazar" && (Servidor.Entero(peticion, "n") ?? 0) == 0 ? AutomationElement.FromHandle(h) : Elemento(peticion, h);
            string nombre;
            try { nombre = e.Current.Name; } catch { throw new InvalidOperationException("Ese elemento ya no está en la ventana: vuelve a mirar con pc_ver."); }
            if (accion == "escribir" && EsSecreto(e)) throw new InvalidOperationException("Es un campo de contraseña o de código: ahí escribe el usuario, nunca Orbe.");

            string hecho = null;
            var parcial = new Parcial();
            // Algunas apps no vuelven de Invoke hasta cerrar el diálogo que abre: se espera un rato y se sigue.
            Servidor.Limitar<object>(5000, parcial, () =>
            {
                hecho = Hacer(e, accion, Servidor.Texto(peticion, "texto"), Servidor.Texto(peticion, "direccion"));
                return null;
            });
            if (parcial.Error != null) throw new InvalidOperationException(parcial.Error);
            return new Dictionary<string, object> { { "nombre", nombre }, { "hecho", hecho ?? "pedido (la aplicación tardó en responder)" } };
        }

        static string Hacer(AutomationElement e, string accion, string texto, string direccion)
        {
            switch (accion)
            {
                case "pulsar":
                    {
                        var inv = Patron<InvokePattern>(e, InvokePattern.Pattern);
                        if (inv != null) { inv.Invoke(); return "pulsado"; }
                        var sel = Patron<SelectionItemPattern>(e, SelectionItemPattern.Pattern);
                        if (sel != null) { sel.Select(); return "seleccionado"; }
                        var tog = Patron<TogglePattern>(e, TogglePattern.Pattern);
                        if (tog != null) { tog.Toggle(); return "marcado o desmarcado"; }
                        var ec = Patron<ExpandCollapsePattern>(e, ExpandCollapsePattern.Pattern);
                        if (ec != null) { Desplegar(ec); return "desplegado o plegado"; }
                        throw new InvalidOperationException("Ese elemento no se puede pulsar por accesibilidad: usa pc_clic en su posición.");
                    }
                case "escribir":
                    {
                        var val = Patron<ValuePattern>(e, ValuePattern.Pattern);
                        if (val == null || val.Current.IsReadOnly) throw new InvalidOperationException("Ese elemento no admite texto por accesibilidad: pulsa en él y usa pc_escribir_texto.");
                        val.SetValue(texto ?? "");
                        return "escrito";
                    }
                case "marcar":
                    {
                        var tog = Patron<TogglePattern>(e, TogglePattern.Pattern);
                        if (tog == null) throw new InvalidOperationException("Ese elemento no es una casilla.");
                        tog.Toggle();
                        return "ahora " + (tog.Current.ToggleState == ToggleState.On ? "marcado" : "sin marcar");
                    }
                case "elegir":
                    {
                        var sel = Patron<SelectionItemPattern>(e, SelectionItemPattern.Pattern);
                        if (sel == null) throw new InvalidOperationException("Ese elemento no se puede elegir.");
                        sel.Select();
                        return "elegido";
                    }
                case "desplegar":
                    {
                        var ec = Patron<ExpandCollapsePattern>(e, ExpandCollapsePattern.Pattern);
                        if (ec == null) throw new InvalidOperationException("Ese elemento no se despliega.");
                        Desplegar(ec);
                        return ec.Current.ExpandCollapseState == ExpandCollapseState.Expanded ? "desplegado" : "plegado";
                    }
                case "desplazar":
                    {
                        if (direccion == "hasta")
                        {
                            var si = Patron<ScrollItemPattern>(e, ScrollItemPattern.Pattern);
                            if (si == null) throw new InvalidOperationException("No puedo llevar la vista hasta ese elemento.");
                            si.ScrollIntoView();
                            return "a la vista";
                        }
                        ScrollPattern sp = null;
                        for (var a = e; a != null && sp == null; a = TreeWalker.ControlViewWalker.GetParent(a)) sp = Patron<ScrollPattern>(a, ScrollPattern.Pattern);
                        if (sp == null)
                            foreach (AutomationElement d in e.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.IsScrollPatternAvailableProperty, true)))
                            { sp = Patron<ScrollPattern>(d, ScrollPattern.Pattern); if (sp != null) break; }
                        if (sp == null) throw new InvalidOperationException("No encuentro nada que se pueda desplazar ahí: prueba con pc_teclas («AvPág»).");
                        var mas = ScrollAmount.LargeIncrement; var menos = ScrollAmount.LargeDecrement; var nada = ScrollAmount.NoAmount;
                        if (direccion == "arriba") sp.Scroll(nada, menos);
                        else if (direccion == "izquierda") sp.Scroll(menos, nada);
                        else if (direccion == "derecha") sp.Scroll(mas, nada);
                        else sp.Scroll(nada, mas);
                        return "desplazado";
                    }
                default: throw new InvalidOperationException("Acción desconocida: " + accion);
            }
        }

        static void Desplegar(ExpandCollapsePattern ec)
        {
            if (ec.Current.ExpandCollapseState == ExpandCollapseState.Expanded) ec.Collapse(); else ec.Expand();
        }

        // ---------------------------------------------------------------------------------
        // Ventanas, ratón y teclado
        // ---------------------------------------------------------------------------------

        static void Pulsar(params Win32.INPUT[] entradas)
        {
            if (Win32.SendInput((uint)entradas.Length, entradas, Marshal.SizeOf(typeof(Win32.INPUT))) != entradas.Length)
                throw new InvalidOperationException("Windows no dejó simular la entrada (¿ventana de administrador?).");
        }

        static Win32.INPUT Tecla(ushort vk, bool soltar)
        {
            var i = new Win32.INPUT { type = 1 };
            i.u.ki.wVk = vk;
            i.u.ki.dwFlags = soltar ? 2u : 0u;
            return i;
        }

        public static Dictionary<string, object> Enfocar(Dictionary<string, object> peticion)
        {
            IntPtr h = Hwnd(peticion);
            AsegurarPrimerPlano(h);
            return new Dictionary<string, object> { { "titulo", Servidor.TituloDe(h) } };
        }

        static void AsegurarPrimerPlano(IntPtr h)
        {
            if (Win32.GetForegroundWindow() == h) return;
            if (Win32.IsIconic(h)) Win32.ShowWindow(h, 9); // SW_RESTORE
            // Windows solo deja traer una ventana al frente a quien recibió la última entrada: un Alt simulado lo permite.
            Pulsar(Tecla(0x12, false), Tecla(0x12, true));
            Win32.SetForegroundWindow(h);
            for (int i = 0; i < 10 && Win32.GetForegroundWindow() != h; i++) Thread.Sleep(50);
            if (Win32.GetForegroundWindow() != h) throw new InvalidOperationException("Windows no dejó traer esa ventana al frente: pídele al usuario que la abra él.");
        }

        public static Dictionary<string, object> Punto(Dictionary<string, object> peticion)
        {
            var p = new Win32.POINT { X = (int)(Servidor.Entero(peticion, "x") ?? 0), Y = (int)(Servidor.Entero(peticion, "y") ?? 0) };
            IntPtr raiz = Win32.GetAncestor(Win32.WindowFromPoint(p), 2); // GA_ROOT
            string nombre = null;
            var parcial = new Parcial();
            Servidor.Limitar<object>(2000, parcial, () =>
            {
                var e = AutomationElement.FromPoint(new System.Windows.Point(p.X, p.Y));
                nombre = e.Current.Name;
                return null;
            });
            return new Dictionary<string, object> { { "hwnd", raiz.ToInt64() }, { "nombre", nombre } };
        }

        public static Dictionary<string, object> Clic(Dictionary<string, object> peticion)
        {
            IntPtr h = Hwnd(peticion);
            int x = (int)(Servidor.Entero(peticion, "x") ?? 0), y = (int)(Servidor.Entero(peticion, "y") ?? 0);
            AsegurarPrimerPlano(h);
            if (Win32.GetAncestor(Win32.WindowFromPoint(new Win32.POINT { X = x, Y = y }), 2) != h)
                throw new InvalidOperationException("En ese punto no está la ventana (hay otra encima o queda fuera): vuelve a mirar con pc_ver.");
            int vx = Win32.GetSystemMetrics(76), vy = Win32.GetSystemMetrics(77), vw = Win32.GetSystemMetrics(78), vh = Win32.GetSystemMetrics(79);
            var mover = new Win32.INPUT { type = 0 };
            mover.u.mi.dx = (int)((x - vx) * 65535L / Math.Max(1, vw - 1));
            mover.u.mi.dy = (int)((y - vy) * 65535L / Math.Max(1, vh - 1));
            mover.u.mi.dwFlags = 0x0001 | 0x8000 | 0x4000; // MOVE | ABSOLUTE | VIRTUALDESK
            bool derecho = Servidor.Texto(peticion, "boton") == "derecho";
            var bajar = new Win32.INPUT { type = 0 }; bajar.u.mi.dwFlags = derecho ? 0x0008u : 0x0002u;
            var subir = new Win32.INPUT { type = 0 }; subir.u.mi.dwFlags = derecho ? 0x0010u : 0x0004u;
            Pulsar(mover, bajar, subir);
            if ((Servidor.Entero(peticion, "doble") ?? 0) == 1) Pulsar(bajar, subir);
            return new Dictionary<string, object> { { "hecho", true } };
        }

        public static Dictionary<string, object> Teclas(Dictionary<string, object> peticion)
        {
            IntPtr h = Hwnd(peticion);
            object v;
            var vks = new List<ushort>();
            if (peticion.TryGetValue("vks", out v) && v is object[])
                foreach (var o in (object[])v) vks.Add(Convert.ToUInt16(o));
            if (vks.Count == 0 || vks.Count > 4) throw new InvalidOperationException("Combinación de teclas no válida.");
            foreach (var vk in vks) if (vk == 0x5B || vk == 0x5C) throw new InvalidOperationException("La tecla Windows no se usa.");
            AsegurarPrimerPlano(h);
            var entradas = new List<Win32.INPUT>();
            foreach (var vk in vks) entradas.Add(Tecla(vk, false));
            for (int i = vks.Count - 1; i >= 0; i--) entradas.Add(Tecla(vks[i], true));
            Pulsar(entradas.ToArray());
            return new Dictionary<string, object> { { "hecho", true } };
        }

        public static Dictionary<string, object> Texto(Dictionary<string, object> peticion)
        {
            IntPtr h = Hwnd(peticion);
            string texto = Servidor.Texto(peticion, "texto") ?? "";
            AsegurarPrimerPlano(h);
            AutomationElement foco = null;
            try { foco = AutomationElement.FocusedElement; } catch { }
            if (foco == null || EsSecreto(foco)) throw new InvalidOperationException("El cursor está en un campo de contraseña o de código (o no sé dónde está): ahí escribe el usuario.");
            var entradas = new List<Win32.INPUT>();
            foreach (char c in texto)
            {
                foreach (bool soltar in new[] { false, true })
                {
                    var i = new Win32.INPUT { type = 1 };
                    i.u.ki.wScan = c;
                    i.u.ki.dwFlags = 0x0004u | (soltar ? 2u : 0u); // UNICODE (| KEYUP)
                    entradas.Add(i);
                }
            }
            if (entradas.Count > 0) Pulsar(entradas.ToArray());
            return new Dictionary<string, object> { { "hecho", true } };
        }

        // ---------------------------------------------------------------------------------
        // Vigilancia: si el usuario toca el ratón o el teclado mientras Orbe actúa, se avisa al momento
        // ---------------------------------------------------------------------------------

        static volatile bool vigilando;
        static Thread hiloGanchos;
        static Win32.HookProc ganchoTeclado, ganchoRaton; // referencias vivas: si el recolector los suelta, Windows llama a nada
        static int baseX = int.MinValue, baseY;

        public static Dictionary<string, object> Vigilar(Dictionary<string, object> peticion)
        {
            bool activo = (Servidor.Entero(peticion, "activo") ?? 0) == 1;
            if (activo && hiloGanchos == null)
            {
                hiloGanchos = new Thread(Ganchos) { IsBackground = true, Name = "ganchos-entrada" };
                hiloGanchos.Start();
            }
            baseX = int.MinValue;
            vigilando = activo;
            return new Dictionary<string, object> { { "vigilando", activo } };
        }

        static void Avisar(string que)
        {
            if (!vigilando) return;
            vigilando = false;
            ThreadPool.QueueUserWorkItem(_ => Servidor.Escribir(new Dictionary<string, object> { { "tipo", "usuario" }, { "que", que } }));
        }

        static bool DeOrbe(IntPtr h)
        {
            int pid;
            Win32.GetWindowThreadProcessId(Win32.GetAncestor(h, 2), out pid);
            return pid == Servidor.pidOrbe;
        }

        static void Ganchos()
        {
            ganchoTeclado = (code, w, l) =>
            {
                if (code >= 0 && vigilando)
                {
                    var k = (Win32.KBDLL)Marshal.PtrToStructure(l, typeof(Win32.KBDLL));
                    // 0x10 = inyectada (la simuló Orbe). Esc siempre para; el resto, salvo si escribes en Orbe.
                    if ((k.flags & 0x10) == 0 && (k.vk == 0x1B || !DeOrbe(Win32.GetForegroundWindow()))) Avisar(k.vk == 0x1B ? "esc" : "teclado");
                }
                return Win32.CallNextHookEx(IntPtr.Zero, code, w, l);
            };
            ganchoRaton = (code, w, l) =>
            {
                if (code >= 0 && vigilando)
                {
                    var m = (Win32.MSLL)Marshal.PtrToStructure(l, typeof(Win32.MSLL));
                    if ((m.flags & 0x1) == 0 && !DeOrbe(Win32.WindowFromPoint(m.pt)))
                    {
                        if (w.ToInt32() != 0x0200) Avisar("raton"); // clic o rueda
                        else if (baseX == int.MinValue) { baseX = m.pt.X; baseY = m.pt.Y; }
                        else if (Math.Abs(m.pt.X - baseX) + Math.Abs(m.pt.Y - baseY) > 12) Avisar("raton"); // no por un temblor
                    }
                }
                return Win32.CallNextHookEx(IntPtr.Zero, code, w, l);
            };
            IntPtr modulo = Win32.GetModuleHandle(null);
            Win32.SetWindowsHookEx(13, ganchoTeclado, modulo, 0);
            Win32.SetWindowsHookEx(14, ganchoRaton, modulo, 0);
            Win32.MSG msg;
            while (Win32.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        }
    }
}
