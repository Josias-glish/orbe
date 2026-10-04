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
        static int pidOrbe;
        static IntPtr ultimaExterna = IntPtr.Zero;
        static readonly object cerrojo = new object();
        static readonly object cerrojoSalida = new object();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 32 };
        static TextWriter salida;

        // Ventanas del propio sistema que nunca son «la ventana del usuario».
        static readonly HashSet<string> ClasesSistema = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "NotifyIconOverflowWindow",
            "TaskListThumbnailWnd", "MultitaskingViewFrame", "ForegroundStaging", "XamlExplorerHostIslandWindow",
            "TopLevelWindowForOverflowXamlIsland"
        };
        static readonly HashSet<string> ProcesosSistema = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
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

        static void Escribir(Dictionary<string, object> mensaje)
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
                    default: throw new InvalidOperationException("Operación desconocida: " + op);
                }
                Escribir(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "datos", datos } });
            }
            catch (Exception e)
            {
                Escribir(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", e.GetType().Name + ": " + e.Message } });
            }
        }

        static string Texto(Dictionary<string, object> d, string clave)
        {
            object v;
            return d.TryGetValue(clave, out v) && v != null ? v.ToString() : null;
        }

        static long? Entero(Dictionary<string, object> d, string clave)
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

        static string ClaseDe(IntPtr h)
        {
            var sb = new StringBuilder(256);
            Win32.GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        static string TituloDe(IntPtr h)
        {
            var sb = new StringBuilder(512);
            Win32.GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        static string NombreProceso(int pid)
        {
            try { return Process.GetProcessById(pid).ProcessName; } catch { return null; }
        }

        /// ¿Es una ventana de usuario (no de Orbe, ni de la barra de tareas, ni del menú Inicio)?
        static bool EsVentanaExterna(IntPtr h)
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
        static IntPtr ResolverObjetivo(Dictionary<string, object> peticion, out bool primerPlano)
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

        static Dictionary<string, object> OpVentana(Dictionary<string, object> peticion)
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
                { "restringida", restringida }
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
        static T Limitar<T>(int milisegundos, Parcial parcial, Func<T> trabajo) where T : class
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

        static bool EsVentanaWeb(IntPtr h)
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
        static List<AutomationElement> DocumentosListos(AutomationElement raiz, bool esperar, Parcial parcial)
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
}
