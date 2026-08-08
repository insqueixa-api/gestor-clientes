"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCcw, ChevronDown, MessageSquare } from "lucide-react";

// ── Tipos de eventos do monitor ───────────────────────────────
type BotEvent = {
  type: "bot_responded" | "human_takeover" | "ignored" | "timeout" | "error";
  phone: string;
  display_name: string | null;
  server_name: string | null;
  server_username: string | null;
  preview: string | null;
  full_response: string | null;
  timestamp: string;
  reason?: string;
};

/**
 * Painel do Monitor do Bot, pra uso INLINE (aba dentro de outra página) —
 * extraído do modal que existia em app/admin/settings/whatsapp/page.tsx
 * (pedido do Márcio: ele quase não visita aquela página, então o Monitor
 * se perdia lá; agora vive como 3ª aba em Auditoria do Portal, ao lado de
 * IPTV/Aplicativos, onde ele realmente olha todo dia).
 */
export default function BotMonitorPanel() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<"feed" | "contacts">("feed");
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);

  async function fetchEvents() {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/bot/events");
      const json = await res.json();
      if (json.ok) {
        setEvents(json.events || []);
        setLastFetch(new Date());
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchEvents();
  }, []);

  const contacts = Object.values(
    events.reduce((acc: Record<string, BotEvent>, ev) => {
      if (!acc[ev.phone] || ev.timestamp > acc[ev.phone].timestamp) {
        acc[ev.phone] = ev;
      }
      return acc;
    }, {}),
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const contactEvents = selectedContact
    ? events.filter((e) => e.phone === selectedContact)
    : [];

  function statusConfig(type: BotEvent["type"], reason?: string) {
    if (type === "bot_responded")
      return {
        emoji: "🤖",
        label: "Bot respondeu",
        color: "text-emerald-500",
        bg: "bg-emerald-500/10 border-emerald-500/20",
      };
    if (type === "human_takeover")
      return {
        emoji: "👤",
        label: "Atendimento humano",
        color: "text-amber-500",
        bg: "bg-amber-500/10 border-amber-500/20",
      };
    if (type === "ignored" && reason === "bot_disabled")
      return {
        emoji: "🔇",
        label: "Bot desligado",
        color: "text-muted-foreground",
        bg: "bg-muted/50 border-border",
      };
    if (type === "ignored")
      return {
        emoji: "⚫",
        label: "Ignorado",
        color: "text-muted-foreground",
        bg: "bg-muted/50 border-border",
      };
    if (type === "timeout")
      return {
        emoji: "⏳",
        label: "Timeout",
        color: "text-orange-500",
        bg: "bg-orange-500/10 border-orange-500/20",
      };
    if (type === "error")
      return {
        emoji: "❌",
        label: "Erro",
        color: "text-rose-500",
        bg: "bg-rose-500/10 border-rose-500/20",
      };
    return {
      emoji: "❓",
      label: type,
      color: "text-muted-foreground",
      bg: "bg-muted/50 border-border",
    };
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  }

  function formatRelative(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s atrás`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
    return `${Math.floor(diff / 86400)}d atrás`;
  }

  function serverLabel(ev: BotEvent) {
    if (!ev.server_name) return null;
    return ev.server_username
      ? `${ev.server_username} · ${ev.server_name}`
      : ev.server_name;
  }

  return (
    <div className="bg-card w-full h-[600px] max-h-[75vh] border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Monitor do Bot
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {lastFetch
                ? `Atualizado às ${lastFetch.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : "Aguardando dados..."}
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchEvents()}
          disabled={loading}
          className="h-8 px-3 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="w-3.5 h-3.5" />
          )}{" "}
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => {
            setActiveTab("feed");
            setSelectedContact(null);
          }}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === "feed" ? "text-emerald-500 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground"}`}
        >
          Feed de Eventos ({events.length})
        </button>
        <button
          onClick={() => setActiveTab("contacts")}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === "contacts" ? "text-emerald-500 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground"}`}
        >
          Contatos ({contacts.length})
        </button>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-hidden flex">
        {/* FEED */}
        {activeTab === "feed" && (
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {loading && events.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-xs text-muted-foreground animate-pulse">
                Carregando eventos...
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground">
                <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-xs">Nenhum evento registrado ainda.</p>
              </div>
            ) : (
              events.map((ev, i) => {
                const s = statusConfig(ev.type, ev.reason);
                const isExpanded = expandedEvent === i;
                const label = serverLabel(ev);
                return (
                  <div
                    key={i}
                    className="px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setExpandedEvent(isExpanded ? null : i)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-base shrink-0 mt-0.5">
                        {s.emoji}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className={`text-[10px] font-semibold ${s.color}`}
                          >
                            {s.label}
                          </span>
                          {label && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                              {label}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            {formatTime(ev.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-foreground truncate">
                          {ev.display_name || ev.phone}
                          {ev.display_name && (
                            <span className="text-muted-foreground font-normal ml-1 font-mono">
                              · {ev.phone}
                            </span>
                          )}
                        </p>
                        {ev.preview && !isExpanded && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {ev.preview}
                          </p>
                        )}
                        {isExpanded && ev.full_response && (
                          <div className="mt-2 p-2.5 bg-muted/40 rounded-lg border border-border">
                            <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                              {ev.full_response}
                            </p>
                          </div>
                        )}
                        {isExpanded && !ev.full_response && ev.preview && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {ev.preview}
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* CONTATOS — lista + detalhe lado a lado */}
        {activeTab === "contacts" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Lista de contatos */}
            <div className="w-64 border-r border-border overflow-y-auto shrink-0">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground p-4">
                  <p className="text-xs">Nenhum contato ainda.</p>
                </div>
              ) : (
                contacts.map((ev, i) => {
                  const s = statusConfig(ev.type, ev.reason);
                  const isSelected = selectedContact === ev.phone;
                  return (
                    <div
                      key={i}
                      onClick={() =>
                        setSelectedContact(isSelected ? null : ev.phone)
                      }
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border ${isSelected ? "bg-emerald-500/5 border-l-2 border-l-emerald-500" : ""}`}
                    >
                      <div
                        className={`w-8 h-8 rounded-xl border flex items-center justify-center text-sm shrink-0 ${s.bg}`}
                      >
                        {s.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">
                          {ev.display_name || ev.phone}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`text-[10px] font-medium ${s.color}`}
                          >
                            {s.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            · {formatRelative(ev.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Detalhe do contato selecionado */}
            <div className="flex-1 overflow-y-auto">
              {!selectedContact ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs">
                    Selecione um contato para ver o histórico
                  </p>
                </div>
              ) : (
                <div className="p-4 space-y-1">
                  {/* Header do contato */}
                  <div className="pb-3 mb-3 border-b border-border">
                    <p className="text-sm font-semibold text-foreground">
                      {contacts.find((c) => c.phone === selectedContact)
                        ?.display_name || selectedContact}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {selectedContact}
                    </p>
                    {contacts.find((c) => c.phone === selectedContact)
                      ?.server_username && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {serverLabel(
                          contacts.find((c) => c.phone === selectedContact)!,
                        )}
                      </p>
                    )}
                  </div>
                  {/* Histórico de eventos do contato */}
                  {contactEvents.map((ev, i) => {
                    const s = statusConfig(ev.type, ev.reason);
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{s.emoji}</span>
                          <span
                            className={`text-[10px] font-semibold ${s.color}`}
                          >
                            {s.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {formatTime(ev.timestamp)}
                          </span>
                        </div>
                        {ev.full_response && (
                          <div className="ml-6 p-2.5 bg-muted/40 rounded-lg border border-border">
                            <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                              {ev.full_response}
                            </p>
                          </div>
                        )}
                        {!ev.full_response && ev.preview && (
                          <p className="ml-6 text-[10px] text-muted-foreground">
                            {ev.preview}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
