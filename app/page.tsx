"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Address,
  Hex,
  createPublicClient,
  defineChain,
  formatEther,
  http,
} from "viem";

type WhaleTransaction = {
  hash: Hex;
  walletAddress: Address;
  amountRaw: bigint;
  amountFormatted: string;
  timestamp: string;
  blockNumber?: bigint;
};

const SOMNIA_TESTNET = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: {
    name: "Somnia Testnet Token",
    symbol: "STT",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://dream-rpc.somnia.network"],
      webSocket: ["wss://dream-rpc.somnia.network/ws"],
    },
    public: {
      http: ["https://dream-rpc.somnia.network"],
      webSocket: ["wss://dream-rpc.somnia.network/ws"],
    },
  },
});

// 0.01 STT with 18 decimals
const WHALE_THRESHOLD_WEI = 10n ** 16n;
const WHALE_THRESHOLD_LABEL = `${formatEther(WHALE_THRESHOLD_WEI)} STT`;
const MAX_EVENTS = 50;

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<WhaleTransaction[]>([]);
  const [walletFilter, setWalletFilter] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const seenTxsRef = useRef<Set<Hex>>(new Set());

  const stats = useMemo(() => {
    if (events.length === 0) {
      return {
        totalTxs: 0,
        largestRaw: 0n,
        largestFormatted: "0 STT",
        totalVolumeFormatted: "0 STT",
      };
    }

    let largestRaw = 0n;
    let totalVolume = 0n;

    for (const e of events) {
      if (e.amountRaw > largestRaw) largestRaw = e.amountRaw;
      totalVolume += e.amountRaw;
    }

    return {
      totalTxs: events.length,
      largestRaw,
      largestFormatted: `${formatEther(largestRaw)} STT`,
      totalVolumeFormatted: `${formatEther(totalVolume)} STT`,
    };
  }, [events]);

  const classifySize = useCallback((amountRaw: bigint) => {
    const ONE_STT = 10n ** 18n;
    const TEN_STT = 10n * ONE_STT;
    if (amountRaw >= TEN_STT) return "large";
    if (amountRaw >= ONE_STT) return "medium";
    return "small";
  }, []);

  const amountColorClass = useCallback(
    (amountRaw: bigint) => {
      const size = classifySize(amountRaw);
      if (size === "large") return "text-emerald-300";
      if (size === "medium") return "text-amber-300";
      return "text-slate-100";
    },
    [classifySize]
  );

  const sizeDotClass = useCallback(
    (amountRaw: bigint) => {
      const size = classifySize(amountRaw);
      if (size === "large")
        return "bg-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.95)]";
      if (size === "medium")
        return "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.65)]";
      return "bg-slate-200/90 shadow-[0_0_12px_rgba(226,232,240,0.35)]";
    },
    [classifySize]
  );

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: SOMNIA_TESTNET,
        transport: http("https://dream-rpc.somnia.network"),
      }),
    []
  );

  const clearFeed = useCallback(() => {
    seenTxsRef.current = new Set();
    setEvents([]);
  }, []);

  const normalizedWalletFilter = walletFilter.trim().toLowerCase();
  const filteredEvents = useMemo(() => {
    if (!normalizedWalletFilter) return events;
    return events.filter((e) =>
      e.walletAddress.toLowerCase().includes(normalizedWalletFilter)
    );
  }, [events, normalizedWalletFilter]);

  useEffect(() => {
    let isCancelled = false;

    const poll = async () => {
      if (isCancelled) return;
      try {
        const block = await publicClient.getBlock({
          blockTag: "latest",
          includeTransactions: true,
        });

        const timestampSeconds = (block as any).timestamp;
        const timestampMs =
          typeof timestampSeconds === "bigint"
            ? Number(timestampSeconds) * 1000
            : typeof timestampSeconds === "number"
            ? timestampSeconds * 1000
            : Date.now();

        const newWhales: WhaleTransaction[] = [];

        for (const tx of block.transactions) {
          const hash = tx.hash as Hex;
          if (seenTxsRef.current.has(hash)) continue;
          seenTxsRef.current.add(hash);

          const value = (tx as any).value ?? 0n;
          const isWhale = value >= WHALE_THRESHOLD_WEI;
          if (!isWhale) continue;

          const walletAddress = (tx as any).from as Address;
          const amountFormatted = `${formatEther(value)} STT`;

          newWhales.push({
            hash,
            walletAddress,
            amountRaw: value,
            amountFormatted,
            timestamp: new Date(timestampMs).toLocaleString(),
            blockNumber: block.number,
          });
        }

        if (newWhales.length > 0 && !isCancelled) {
          setEvents((prev) => {
            const next = [...newWhales, ...prev];
            return next.slice(0, MAX_EVENTS);
          });
        }

        if (!isCancelled) {
          setIsConnected(true);
          setError(null);
          setLastUpdatedAt(new Date());
        }
      } catch (err: any) {
        console.error("HTTP polling error", err);
        if (!isCancelled) {
          setError(err.message ?? "Failed to poll Somnia RPC");
          setIsConnected(false);
        }
      }
    };

    // Initial poll, then interval
    void poll();
    const intervalId = setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [publicClient]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <style jsx global>{`
        @keyframes somnia-hero-gradient {
          0% {
            transform: translate3d(-10%, -10%, 0) scale(1);
            filter: hue-rotate(0deg);
          }
          50% {
            transform: translate3d(10%, 10%, 0) scale(1.06);
            filter: hue-rotate(12deg);
          }
          100% {
            transform: translate3d(-10%, -10%, 0) scale(1);
            filter: hue-rotate(0deg);
          }
        }

        @keyframes somnia-fade-in-up {
          from {
            opacity: 0;
            transform: translate3d(0, 10px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        .somnia-hero-bg {
          animation: somnia-hero-gradient 14s ease-in-out infinite;
          will-change: transform, filter;
        }

        .somnia-row-enter {
          animation: somnia-fade-in-up 420ms ease-out both;
        }

        @keyframes somnia-marquee {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-50%, 0, 0);
          }
        }

        .somnia-marquee {
          animation: somnia-marquee 22s linear infinite;
          will-change: transform;
        }
      `}</style>
      <div className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10" />
          <div className="flex items-center gap-3 px-4 py-2 text-[11px] text-slate-300 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 ring-1 ring-slate-700/70">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  isConnected
                    ? "bg-emerald-400 animate-pulse shadow-[0_0_18px_rgba(16,185,129,1)]"
                    : "bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.6)]",
                ].join(" ")}
              />
              <span className="font-semibold text-slate-100">
                {isConnected ? "LIVE" : "SYNCING"}
              </span>
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="somnia-marquee flex w-[200%] items-center gap-10 whitespace-nowrap">
                <div className="flex w-1/2 items-center gap-10">
                  <span className="text-slate-400">Somnia Testnet</span>
                  <span>
                    Total detected:{" "}
                    <span className="font-semibold text-slate-100">
                      {stats.totalTxs}
                    </span>
                  </span>
                  <span>
                    Total volume:{" "}
                    <span className="font-semibold text-emerald-200">
                      {stats.totalVolumeFormatted}
                    </span>
                  </span>
                  <span>
                    Largest tx:{" "}
                    <span className="font-semibold text-teal-200">
                      {stats.largestFormatted}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    Threshold: {WHALE_THRESHOLD_LABEL}
                  </span>
                </div>
                <div className="flex w-1/2 items-center gap-10">
                  <span className="text-slate-400">Somnia Testnet</span>
                  <span>
                    Total detected:{" "}
                    <span className="font-semibold text-slate-100">
                      {stats.totalTxs}
                    </span>
                  </span>
                  <span>
                    Total volume:{" "}
                    <span className="font-semibold text-emerald-200">
                      {stats.totalVolumeFormatted}
                    </span>
                  </span>
                  <span>
                    Largest tx:{" "}
                    <span className="font-semibold text-teal-200">
                      {stats.largestFormatted}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    Threshold: {WHALE_THRESHOLD_LABEL}
                  </span>
                </div>
              </div>
            </div>
            <div className="hidden shrink-0 text-[11px] text-slate-400 sm:block">
              Last updated:{" "}
              <span className="font-semibold text-slate-200">
                {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString() : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-950/50 px-5 py-6 shadow-[0_18px_80px_rgba(15,23,42,0.85)] sm:px-8 sm:py-7">
          <div className="pointer-events-none absolute inset-0">
            <div className="somnia-hero-bg absolute -inset-24 opacity-60 blur-3xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.30),transparent_50%),radial-gradient(circle_at_80%_30%,rgba(45,212,191,0.22),transparent_48%),radial-gradient(circle_at_50%_80%,rgba(34,211,238,0.16),transparent_52%)]" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-slate-950/60 to-slate-950/90" />
          </div>

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/40">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.9)]" />
                Somnia Whale Tracker
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
                Trading-style transaction feed
              </h1>
              <p className="max-w-2xl text-sm text-slate-400">
                A dense, terminal-style stream of detected transfers on Somnia
                Testnet. Threshold:{" "}
                <span className="font-semibold text-teal-300">
                  {WHALE_THRESHOLD_LABEL}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-col items-end gap-3 text-sm">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 ring-1 ring-slate-700/80">
                <span
                  className={[
                    "h-2 w-2 rounded-full bg-emerald-400",
                    isConnected
                      ? "animate-pulse shadow-[0_0_18px_rgba(16,185,129,1)]"
                      : "shadow-[0_0_10px_rgba(16,185,129,0.6)]",
                  ].join(" ")}
                />
                <span className="font-medium text-slate-100">
                  {isConnected ? "Live" : "Connecting..."}
                </span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 text-xs text-slate-400 ring-1 ring-slate-800">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                Somnia Testnet • RPC `dream-rpc.somnia.network`
              </div>
              <div className="text-xs text-slate-500">
                Last updated:{" "}
                <span className="font-semibold text-slate-200">
                  {lastUpdatedAt ? lastUpdatedAt.toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </div>
        </header>

        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <div className="rounded-xl border border-teal-500/20 bg-slate-950/70 px-3 py-2 shadow-[0_0_0_1px_rgba(45,212,191,0.06),0_12px_40px_rgba(15,23,42,0.65),0_0_18px_rgba(45,212,191,0.10)]">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                Total
              </div>
              <div className="text-sm font-semibold text-slate-100">
                {stats.totalTxs}
              </div>
            </div>
            <div className="rounded-xl border border-teal-500/20 bg-slate-950/70 px-3 py-2 shadow-[0_0_0_1px_rgba(45,212,191,0.06),0_12px_40px_rgba(15,23,42,0.65),0_0_18px_rgba(45,212,191,0.10)]">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                Largest
              </div>
              <div className="text-sm font-semibold text-teal-200">
                {stats.largestFormatted}
              </div>
            </div>
            <div className="rounded-xl border border-teal-500/20 bg-slate-950/70 px-3 py-2 shadow-[0_0_0_1px_rgba(45,212,191,0.06),0_12px_40px_rgba(15,23,42,0.65),0_0_18px_rgba(45,212,191,0.10)]">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                Volume
              </div>
              <div className="text-sm font-semibold text-emerald-200">
                {stats.totalVolumeFormatted}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              <span className="font-medium">Connection issue:</span>{" "}
              <span>{error}</span>
            </div>
          )}
        </section>

        <section className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/70 text-xs font-semibold text-teal-300 ring-1 ring-slate-700">
                {filteredEvents.length}
              </span>
              <span>
                Detected transactions (newest first).
              </span>
            </div>
            <button
              type="button"
              onClick={clearFeed}
              className="inline-flex items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-teal-500/70 hover:text-teal-200 hover:bg-slate-900/40 focus:outline-none focus:ring-2 focus:ring-teal-500/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={events.length === 0}
              aria-disabled={events.length === 0}
            >
              Clear Feed
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xl">
              <input
                value={walletFilter}
                onChange={(e) => setWalletFilter(e.target.value)}
                placeholder="Filter by wallet address (e.g. 0xabc...)"
                className="w-full rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 shadow-[0_12px_40px_rgba(15,23,42,0.55)] outline-none transition focus:border-teal-500/70 focus:ring-2 focus:ring-teal-500/40"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="text"
              />
              {walletFilter.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setWalletFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-slate-900/60 hover:text-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                  aria-label="Clear wallet filter"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="text-xs text-slate-500 sm:text-right">
              Showing{" "}
              <span className="font-semibold text-slate-200">
                {filteredEvents.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-200">
                {events.length}
              </span>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-950/80 via-slate-950/90 to-slate-950/80 shadow-[0_18px_60px_rgba(15,23,42,0.9)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-emerald-500/15 via-transparent to-transparent blur-2xl" />

            <div className="relative h-full">
              <div className="grid grid-cols-[16px_minmax(0,2.6fr)_minmax(0,1.6fr)_minmax(0,3fr)_minmax(0,1.7fr)] gap-3 border-b border-slate-800/80 bg-slate-950/90 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500 sm:px-6">
                <div />
                <div>Wallet</div>
                <div>Amount</div>
                <div>Transaction</div>
                <div className="text-right">Time</div>
              </div>

              <div className="h-[480px] overflow-y-auto px-2 py-2 sm:px-4">
                {filteredEvents.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
                    <p>
                      {events.length === 0
                        ? "No whale transactions detected yet."
                        : "No matches for the current filter."}
                    </p>
                    <p className="text-xs text-slate-500">
                      Keep this page open to watch the live feed as whales move
                      on Somnia Testnet.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {filteredEvents.map((event) => (
                      <li
                        key={`${event.hash}-${event.timestamp}`}
                        className="somnia-row-enter group rounded-lg border border-slate-800/70 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-200 shadow-[0_10px_40px_rgba(15,23,42,0.65)] transition hover:border-teal-500/80 hover:bg-slate-900/70 sm:px-4"
                      >
                        <div className="grid grid-cols-[16px_minmax(0,2.6fr)_minmax(0,1.6fr)_minmax(0,3fr)_minmax(0,1.7fr)] items-center gap-3">
                          <span
                            className={[
                              "h-2.5 w-2.5 rounded-full",
                              sizeDotClass(event.amountRaw),
                            ].join(" ")}
                            aria-hidden="true"
                            title={`Size: ${classifySize(event.amountRaw)}`}
                          />
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-sm leading-none">🐋</span>
                            <a
                              href={`https://shannon-explorer.somnia.network/address/${event.walletAddress}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="min-w-0 truncate font-mono text-[11px] text-slate-200 underline-offset-2 hover:text-teal-200 hover:underline"
                            >
                              {event.walletAddress}
                            </a>
                          </div>
                          <div
                            className={[
                              "font-semibold tabular-nums",
                              amountColorClass(event.amountRaw),
                            ].join(" ")}
                          >
                            {event.amountFormatted}
                          </div>
                          <div className="flex flex-col gap-1">
                            <a
                              href={`https://shannon-explorer.somnia.network/tx/${event.hash}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="truncate font-mono text-[11px] text-slate-400 underline-offset-2 hover:text-teal-200 hover:underline"
                            >
                              {event.hash}
                            </a>
                            {event.blockNumber != null && (
                              <span className="text-[10px] text-slate-500 sm:text-[11px]">
                                Block #{event.blockNumber.toString()}
                              </span>
                            )}
                          </div>
                          <div className="text-right text-[11px] text-slate-300">
                            {event.timestamp}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
