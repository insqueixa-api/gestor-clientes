"use client";
// app/revenda/AppsSection.tsx
// ✅ 07/10/2026: "Ativar ou configurar aplicativos" do Portal da Revenda.
// Pedido do Márcio: a revenda não tem lista de apps na conta dela — abriu o
// menu, já cai no seletor de aparelho (mesmo AppPickerModal do portal do
// cliente, com o guia rápido antes do X). Escolheu o app → informa os dados
// do aparelho + link M3U do cliente → Configurar / Verificar / Remover na hora.
// O cadastro fica só por dentro (reseller_client_apps, reaproveitado por
// app+MAC+usuário) pra licença paga e histórico. Pagamento da licença: etapa B.
import { useEffect, useState } from "react";
import { Settings, Star, Zap } from "lucide-react";
import AppPickerModal, {
  type AppPickerCatalogItem,
} from "@/components/apps/AppPickerModal";

type CatalogItem = AppPickerCatalogItem & {
  fields?: { id: string; type: string; label: string }[];
};
type Row = {
  id: string;
  client_label: string | null;
  expire_date: string | null;
  m3u_username: string | null;
  server_name: string | null;
  list_name: string | null;
  configured_at: string | null;
  license_price: number | null;
  configure_blocked: boolean;
  can_check: boolean;
  can_configure: boolean;
};

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n,
  );
const dateBR = (d: string | null) => {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  if (!m) return "—";
  return m[1] === "9999" ? "Vitalício" : `${m[3]}/${m[2]}/${m[1]}`;
};

export default function AppsSection({
  session,
  supportPhone,
  resellerName,
}: {
  session: string;
  supportPhone: string | null;
  resellerName: string;
}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [deviceIcons, setDeviceIcons] = useState<Record<string, string>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [chosen, setChosen] = useState<{
    app: CatalogItem;
    deviceType: string | null;
  } | null>(null);

  async function call(payload: Record<string, unknown>) {
    const r = await fetch("/api/reseller-portal/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: session, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Falha na operação.");
    return j;
  }

  useEffect(() => {
    let alive = true;
    setCatalogLoading(true);
    call({ action: "catalog" })
      .then((j) => {
        if (!alive) return;
        setCatalog(j.data as CatalogItem[]);
        setDeviceIcons(j.device_icons || {});
      })
      .catch(
        (e: any) =>
          alive &&
          setCatalogErr(
            e?.message || "Não foi possível carregar os aplicativos.",
          ),
      )
      .finally(() => alive && setCatalogLoading(false));
    return () => {
      alive = false;
    };
  }, [session]);

  const supportDigits = String(supportPhone || "").replace(/\D/g, "");

  return (
    <div className="space-y-3 sm:space-y-4 px-3 sm:px-0">
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">
            Ativar ou configurar aplicativos
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Escolha o aparelho e o aplicativo do seu cliente, informe os dados e
            configure a lista na hora.
          </p>
          {catalogErr && (
            <p className="text-xs text-rose-500 mt-1">{catalogErr}</p>
          )}
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="shrink-0 h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
        >
          Escolher aplicativo
        </button>
      </div>

      {/* ✅ 07/10/2026: mesmo bloco do portal do cliente, texto pra revenda; WhatsApp do Márcio */}
      {supportDigits && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm sm:text-base font-bold text-foreground">
              💡 Mantenha os aplicativos dos seus clientes em dia
            </p>
            <ul className="space-y-1.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              <li>
                📺 Seu cliente trocou de TV ou de aplicativo? Escolha o novo app
                aqui e configure de novo.
              </li>
              <li>
                🔄 O app do cliente travou ou parou de funcionar? Escolha o app,
                informe o mesmo MAC e link M3U e toque em{" "}
                <strong className="text-foreground">Configurar</strong> de novo.
              </li>
              <li>
                💬 O problema continuou, não achou o aplicativo ou ficou com
                alguma dúvida? Fale com o suporte.
              </li>
            </ul>
          </div>
          <a
            href={`https://wa.me/${supportDigits}?text=${encodeURIComponent(
              `Olá! Sou a revenda ${resellerName}, vim do Portal da Revenda (Ativar ou configurar aplicativos) e preciso de ajuda.`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold text-sm px-5 py-3 shadow-sm hover:shadow-md transition-all"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            Falar com o suporte
          </a>
        </div>
      )}

      <AppPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        catalog={catalog}
        catalogLoading={catalogLoading}
        busyAppId={null}
        variant="portal"
        title="Ativar ou configurar aplicativo"
        subtitle="Em qual aparelho o seu cliente vai usar?"
        supportWhatsapp={supportPhone}
        deviceIcons={deviceIcons}
        guide={<ResellerAppsGuide />}
        onSelectApp={(appId, deviceType) => {
          const app = catalog.find((c) => c.id === appId);
          if (!app) return;
          setPickerOpen(false);
          setChosen({ app, deviceType: deviceType || null });
        }}
      />

      {chosen && (
        <AppActionModal
          app={chosen.app}
          deviceType={chosen.deviceType}
          call={call}
          onBack={() => {
            setChosen(null);
            setPickerOpen(true);
          }}
          onClose={() => setChosen(null)}
        />
      )}
    </div>
  );
}

/** Guia rápido (mesmo bloco "Como usar Meus Aplicativos" do cliente, texto pra revenda). */
function ResellerAppsGuide() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Como ativar ou configurar
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Guia rápido
        </span>
      </div>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs sm:text-sm text-muted-foreground marker:font-bold marker:text-foreground/70">
        <li>
          Escolha o aparelho do seu cliente. Veja quais desses aplicativos
          existem na{" "}
          <strong className="text-foreground">loja de aplicativos</strong> da TV
          dele (Samsung, LG, Roku, Android) ou do celular.
        </li>
        <li>
          <strong className="text-foreground">Recomendados:</strong> os com{" "}
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-bold text-sky-600">
            <Settings className="w-3 h-3" /> configuração automática
          </span>{" "}
          (a lista vai pro aparelho com um toque) e{" "}
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-600">
            <Zap className="w-3 h-3 fill-current" /> renovação automática
          </span>
          . Quanto mais{" "}
          <Star
            className="inline w-3.5 h-3.5 fill-amber-400 text-amber-400 -mt-0.5"
            strokeWidth={1.5}
          />
          , melhor.
        </li>
        <li>
          <strong className="text-foreground">Todos têm teste grátis</strong> de
          alguns dias: o cliente instala e testa. Gostou? Ative. Não gostou?
          Teste outro.
        </li>
        <li>
          Escolha o aplicativo, preencha os dados que aparecem na tela do app do
          cliente (MAC/ID) e o{" "}
          <strong className="text-foreground">link M3U</strong> dele e toque em{" "}
          <strong className="text-foreground">Continuar</strong>.
        </li>
        <li>
          Toque em <strong className="text-foreground">Configurar</strong> pra
          liberar o sinal — a lista entra com o nome do usuário do M3U. Travou?
          Configure de novo.
        </li>
      </ol>
    </div>
  );
}

function AppActionModal({
  app,
  deviceType,
  call,
  onBack,
  onClose,
}: {
  app: CatalogItem;
  deviceType: string | null;
  call: (p: Record<string, unknown>) => Promise<any>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [m3u, setM3u] = useState("");
  const [clientLabel, setClientLabel] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [row, setRow] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  );

  // ✅ 07/10/2026 (padronizado, pedido do Márcio): NOME DO CLIENTE sempre no
  // topo, qualquer app; "Ambiente" (obs) é do Márcio/cliente final e não
  // aparece pra revenda; TODOS os campos são obrigatórios.
  const fields = (app.fields || []).filter((f) => f.type !== "obs");
  const filled =
    !!m3u.trim() &&
    !!clientLabel.trim() &&
    fields.every((f) => (vals[f.id] || "").trim());

  async function submit() {
    setMsg(null);
    setBusy("add");
    try {
      const j = await call({
        action: "add",
        app_id: app.id,
        device_type: deviceType,
        client_label: clientLabel.trim(),
        m3u_url: m3u.trim(),
        field_values: vals,
      });
      setRow(j.row as Row);
    } catch (e: any) {
      setMsg({
        tone: "err",
        text: e?.message || "Não foi possível continuar.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "configure" | "check" | "remove") {
    if (!row) return;
    if (
      action === "remove" &&
      !window.confirm(
        `Remover a lista ${row.list_name || row.m3u_username || ""} desse aparelho? Só ela sai, as outras ficam.`,
      )
    )
      return;
    setBusy(action);
    setMsg(null);
    try {
      const j = await call({ action, id: row.id });
      if (action === "configure") {
        setRow({
          ...row,
          configured_at: new Date().toISOString(),
          list_name: j.list_name,
          expire_date: j.expire_date || row.expire_date,
        });
        setMsg({
          tone: "ok",
          text: `Configurado: lista ${j.list_name}${j.expire_date ? ` · vence ${dateBR(j.expire_date)}` : ""}.`,
        });
      } else if (action === "check") {
        if (j.expire_date) setRow({ ...row, expire_date: j.expire_date });
        setMsg({
          tone: "ok",
          text: j.expire_date
            ? `Vencimento: ${dateBR(j.expire_date)}.`
            : j.is_trial
              ? "Aparelho em modo de avaliação (sem licença ativa)."
              : "O parceiro não informou vencimento.",
        });
      } else {
        setRow({ ...row, configured_at: null, list_name: null });
        setMsg({ tone: "ok", text: "Lista removida do aparelho." });
      }
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message });
    } finally {
      setBusy(null);
    }
  }

  const input =
    "w-full h-10 px-3 rounded-lg border border-border bg-transparent text-sm text-foreground outline-none focus:border-emerald-500/60";
  const clientNameInput = (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
        Nome do cliente
      </label>
      <input
        value={clientLabel}
        onChange={(e) => setClientLabel(e.target.value)}
        maxLength={80}
        className={input}
        placeholder="Ex.: João da Silva"
      />
    </div>
  );
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/70 text-foreground shrink-0"
            title="Escolher outro aplicativo"
          >
            ←
          </button>
          {app.icon_url ? (
            <img
              src={app.icon_url}
              alt=""
              className="w-9 h-9 rounded-lg object-cover border border-border"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">
              {app.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {deviceType || "Aparelho"}
              {app.license_price
                ? ` · licença ${brl(Number(app.license_price))}/ano`
                : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground text-lg"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          {msg && (
            <div
              className={`text-sm rounded-lg px-3 py-2 ${msg.tone === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-600"}`}
            >
              {msg.text}
            </div>
          )}

          {!row ? (
            <>
              {clientNameInput}
              {fields.map((f) => (
                  <div key={f.id}>
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                      {f.label}
                    </label>
                    <input
                      value={vals[f.id] || ""}
                      onChange={(e) =>
                        setVals((v) => ({ ...v, [f.id]: e.target.value }))
                      }
                      className={`${input} font-mono`}
                      placeholder={f.type === "mac" ? "XX:XX:XX:XX:XX:XX" : ""}
                    />
                  </div>
              ))}
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Link M3U do cliente
                </label>
                <input
                  value={m3u}
                  onChange={(e) => setM3u(e.target.value)}
                  className={`${input} font-mono text-xs`}
                  placeholder="http://…/get.php?username=…&password=…"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  O usuário do link vira o nome da lista no aparelho (ex.:
                  usuario_NaTV).
                </p>
              </div>
              <button
                onClick={() => void submit()}
                disabled={!!busy || !filled}
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50"
              >
                {busy === "add" ? "Conferindo..." : "Continuar"}
              </button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="col-span-2 rounded-lg bg-muted px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Cliente
                  </div>
                  <div className="font-semibold text-foreground truncate">
                    {row.client_label || "—"}
                  </div>
                </div>
                <div className="rounded-lg bg-muted px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Lista
                  </div>
                  <div className="font-mono text-foreground truncate">
                    {row.m3u_username || "—"}
                    {row.server_name ? ` (${row.server_name})` : ""}
                  </div>
                </div>
                <div className="rounded-lg bg-muted px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Vencimento
                  </div>
                  <div className="font-semibold text-foreground">
                    {dateBR(row.expire_date)}
                  </div>
                </div>
              </div>

              {row.configure_blocked && (
                <p className="text-[11px] text-amber-600">
                  Licença{" "}
                  {row.license_price ? `${brl(row.license_price)}/ano` : ""} —
                  esse aplicativo precisa da licença paga antes de configurar
                  (pagamento pelo portal em breve).
                </p>
              )}
              {!row.can_configure && (
                <p className="text-[11px] text-muted-foreground">
                  A configuração da lista desse aplicativo não é feita pelo
                  portal — fale com o suporte.
                </p>
              )}

              {row.can_configure && (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => void act("configure")}
                    disabled={!!busy || row.configure_blocked}
                    className="h-10 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {busy === "configure"
                      ? "Configurando..."
                      : row.configured_at
                        ? "Reconfigurar"
                        : "Configurar m3u"}
                  </button>
                  <button
                    onClick={() => void act("check")}
                    disabled={!!busy || !row.can_check}
                    className="h-10 rounded-lg border border-border text-emerald-600 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    {busy === "check" ? "Verificando..." : "Verificar"}
                  </button>
                  <button
                    onClick={() => void act("remove")}
                    disabled={!!busy}
                    className="h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    {busy === "remove" ? "Removendo..." : "Remover m3u"}
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setRow(null);
                  setMsg(null);
                }}
                disabled={!!busy}
                className="w-full h-9 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Editar dados
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
