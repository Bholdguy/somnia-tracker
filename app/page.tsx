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
  const seenTxsRef = useRef<Set<Hex>>(new Set());

  const stats = useMemo(() => {
    if (events.length === 0) {
      return {
        totalWhales: 0,
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
      totalWhales: events.length,
      largestRaw,
      largestFormatted: `${formatEther(largestRaw)} STT`,
      totalVolumeFormatted: `${formatEther(totalVolume)} STT`,
    };
  }, [events]);

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
      `}</style>
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
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
              Real-time large transaction monitor
            </h1>
            <p className="max-w-2xl text-sm text-slate-400">
              Watching Somnia Testnet for whale-sized transfers in real time.
              Threshold:{" "}
              <span className="font-semibold text-teal-300">
                {WHALE_THRESHOLD_LABEL}
              </span>{" "}
              per transaction.
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
            </div>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1 rounded-2xl border border-teal-500/20 bg-slate-950/70 p-4 shadow-[0_0_0_1px_rgba(45,212,191,0.08),0_18px_60px_rgba(15,23,42,0.75),0_0_28px_rgba(45,212,191,0.10)] sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              Total Whales Detected
            </p>
            <p className="text-2xl font-semibold text-emerald-300">
              {stats.totalWhales}
            </p>
          </div>
          <div className="space-y-1 rounded-2xl border border-teal-500/20 bg-slate-950/70 p-4 shadow-[0_0_0_1px_rgba(45,212,191,0.08),0_18px_60px_rgba(15,23,42,0.75),0_0_28px_rgba(45,212,191,0.10)] sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              Largest Transaction
            </p>
            <p className="text-lg font-semibold text-teal-300">
              {stats.largestFormatted}
            </p>
          </div>
          <div className="space-y-1 rounded-2xl border border-teal-500/20 bg-slate-950/70 p-4 shadow-[0_0_0_1px_rgba(45,212,191,0.08),0_18px_60px_rgba(15,23,42,0.75),0_0_28px_rgba(45,212,191,0.10)] sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              Total Volume
            </p>
            <p className="text-lg font-semibold text-emerald-200">
              {stats.totalVolumeFormatted}
            </p>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span className="font-medium">Connection issue:</span>{" "}
            <span>{error}</span>
          </div>
        )}

        <section className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/70 text-xs font-semibold text-teal-300 ring-1 ring-slate-700">
                {filteredEvents.length}
              </span>
              <span>
                Whale transactions detected in this session. Newest appears at
                the top.
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
              <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] gap-4 border-b border-slate-800/80 bg-slate-950/90 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400 sm:px-6">
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
                        className="somnia-row-enter group rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 py-3 text-xs text-slate-200 shadow-[0_10px_40px_rgba(15,23,42,0.7)] transition hover:border-teal-500/80 hover:bg-slate-900/80 sm:px-4 sm:text-sm"
                      >
                        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] items-center gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-base leading-none">🐋</span>
                            <a
                              href={`https://shannon-explorer.somnia.network/address/${event.walletAddress}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="min-w-0 truncate font-mono text-[11px] text-slate-300 underline-offset-2 hover:text-teal-300 hover:underline sm:text-xs"
                            >
                              {event.walletAddress}
                            </a>
                          </div>
                          <div className="font-semibold text-emerald-300">
                            {event.amountFormatted}
                          </div>
                          <div className="flex flex-col gap-1">
                            <a
                              href={`https://shannon-explorer.somnia.network/tx/${event.hash}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="truncate font-mono text-[11px] text-slate-400 underline-offset-2 hover:text-teal-300 hover:underline sm:text-xs"
                            >
                              {event.hash}
                            </a>
                            {event.blockNumber != null && (
                              <span className="text-[10px] text-slate-500 sm:text-[11px]">
                                Block #{event.blockNumber.toString()}
                              </span>
                            )}
                          </div>
                          <div className="text-right text-[11px] text-slate-300 sm:text-xs">
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
