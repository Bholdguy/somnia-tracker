"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RPC_URL = "/api/blocks";
const WEI_PER_STT = 10n ** 18n;
const MIN_VALUE_WEI = 1n; // value > 0
const MIN_VALUE_LABEL = "> 0 STT";

type WhaleTransaction = {
  hash: string;
  walletAddress: string;
  amountRaw: bigint;
  amountFormatted: string;
  timestamp: string;
  blockNumber?: bigint;
};

const MAX_EVENTS = 50;

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

function hexToBigInt(value: string | undefined | null): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function formatSttFromWei(wei: bigint, decimals = 6): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / WEI_PER_STT;
  const frac = abs % WEI_PER_STT;

  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  const trimmedFrac = fracStr.replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return trimmedFrac.length > 0
    ? `${sign}${whole.toString()}.${trimmedFrac} STT`
    : `${sign}${whole.toString()} STT`;
}
export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<WhaleTransaction[]>([]);
  const [walletFilter, setWalletFilter] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const seenTxsRef = useRef<Set<string>>(new Set());
  const lastProcessedBlockRef = useRef<bigint | null>(null);

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
      largestFormatted: formatSttFromWei(largestRaw),
      totalVolumeFormatted: formatSttFromWei(totalVolume),
    };
  }, [events]);

  const classifySize = useCallback((amountRaw: bigint) => {
    const ONE_STT = WEI_PER_STT;
    const TEN_STT = 10n * WEI_PER_STT;
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

  const clearFeed = useCallback(() => {
    seenTxsRef.current = new Set();
    lastProcessedBlockRef.current = null;
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
    console.log("[Home] mounted. Starting raw JSON-RPC polling.");
    let isCancelled = false;

    const pollOnce = async () => {
      if (isCancelled) return;

      console.log("[poll] tick start");
      try {
        const rpc = async <T,>(
          id: number,
          method: string,
          params: unknown[]
        ): Promise<T> => {
          console.log(`[poll] rpc -> ${method}`, params);
          const res = await fetch(RPC_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          });
          console.log(`[poll] rpc <- ${method} status`, res.status);
          const json = (await res.json()) as JsonRpcResponse<T>;
          if (json.error) {
            console.error("[poll] JSON-RPC error:", json.error);
            throw new Error(json.error.message);
          }
          if (json.result === undefined) {
            console.error("[poll] missing result in JSON-RPC response:", json);
            throw new Error("Missing JSON-RPC result");
          }
          return json.result;
        };

        console.log("[poll] step 1: get latest block number via eth_blockNumber");
        const latestHex = await rpc<string>(1, "eth_blockNumber", []);
        const latest = hexToBigInt(latestHex);
        console.log("[poll] latest block =", latest.toString());

        const start = latest > 4n ? latest - 4n : 0n;
        console.log(
          "[poll] step 2: fetching last 5 blocks:",
          start.toString(),
          "->",
          latest.toString()
        );

        const matching: WhaleTransaction[] = [];

        for (let bn = start; bn <= latest; bn++) {
          const bnHex = `0x${bn.toString(16)}`;
          console.log("[poll] step 3: fetch block", bn.toString(), bnHex);

          const block = await rpc<{
            number: string;
            timestamp: string;
            transactions: Array<{
              hash: string;
              from: string;
              value: string;
            }>;
          }>(2, "eth_getBlockByNumber", [bnHex, true]);

          const blockNumber = hexToBigInt(block.number);
          const timestampSeconds = hexToBigInt(block.timestamp);
          const timestampMs = Number(timestampSeconds) * 1000;

          const txs = Array.isArray(block.transactions) ? block.transactions : [];
          console.log(
            "[poll] block",
            blockNumber.toString(),
            "txs:",
            txs.length
          );

          console.log("[poll] step 4: scan txs; filter value > 0");
          for (const tx of txs) {
            const hash = tx?.hash;
            if (!hash) continue;
            if (seenTxsRef.current.has(hash)) continue;

            const valueWei = hexToBigInt(tx.value);
            if (valueWei < MIN_VALUE_WEI) continue;

            seenTxsRef.current.add(hash);

            matching.push({
              hash,
              walletAddress: tx.from ?? "0x",
              amountRaw: valueWei,
              amountFormatted: formatSttFromWei(valueWei),
              timestamp: new Date(timestampMs).toLocaleString(),
              blockNumber,
            });
          }
        }

        console.log("[poll] step 5: matching tx count =", matching.length);

        if (!isCancelled && matching.length > 0) {
          console.log("[poll] step 6: adding to feed");
          setEvents((prev) => {
            const next = [...matching, ...prev];
            return next.slice(0, MAX_EVENTS);
          });
        } else {
          console.log("[poll] step 6: nothing to add this tick");
        }

        if (!isCancelled) {
          lastProcessedBlockRef.current = latest;
          setIsConnected(true);
          setError(null);
          setLastUpdatedAt(new Date());
        }

        console.log("[poll] tick end");
      } catch (e) {
        console.error("[poll] error during tick:", e);
        if (!isCancelled) {
          setIsConnected(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    // Initial poll, then interval every 5 seconds
    void pollOnce();
    const intervalId = setInterval(() => {
      void pollOnce();
    }, 5000);

    return () => {
      console.log("[Home] unmount. Stopping polling.");
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 antialiased">
      <style jsx global>{`
        :root {
          --space: #0a0a0f;
          --cyan: #00ffff;
          --neon: #00ff88;
          --grid: rgba(0, 255, 255, 0.08);
          --scan: rgba(255, 255, 255, 0.04);
          --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
        }

        html,
        body {
          background: var(--space);
        }

        .font-terminal {
          font-family: var(--mono);
          font-variant-numeric: tabular-nums;
        }

        @keyframes neon-pulse {
          0% {
            box-shadow: 0 0 0 rgba(0, 255, 136, 0);
          }
          40% {
            box-shadow: 0 0 18px rgba(0, 255, 136, 0.9),
              0 0 42px rgba(0, 255, 255, 0.25);
          }
          100% {
            box-shadow: 0 0 0 rgba(0, 255, 136, 0);
          }
        }

        @keyframes matrix-drift {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(0, 240px, 0);
          }
        }

        @keyframes scanline {
          0% {
            transform: translate3d(0, -20%, 0);
          }
          100% {
            transform: translate3d(0, 120%, 0);
          }
        }

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

        .ticker-glow {
          text-shadow: 0 0 10px rgba(0, 255, 255, 0.35),
            0 0 24px rgba(0, 255, 136, 0.25);
        }

        .neon-border {
          border-color: rgba(0, 255, 255, 0.22);
          box-shadow: 0 0 0 1px rgba(0, 255, 255, 0.12),
            0 0 26px rgba(0, 255, 255, 0.10),
            0 0 42px rgba(0, 255, 136, 0.06);
        }

        .terminal-scanline {
          animation: scanline 5.5s linear infinite;
        }

        .matrix-bg {
          animation: matrix-drift 7s linear infinite;
          will-change: transform;
        }
      `}</style>

      {/* Terminal overlays */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        {/* Grid */}
        <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,var(--grid)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid)_1px,transparent_1px)] [background-size:44px_44px]" />
        {/* Subtle matrix drift */}
        <div className="matrix-bg absolute inset-0 opacity-35 [background-image:repeating-linear-gradient(180deg,rgba(0,255,136,0.12)_0px,rgba(0,255,136,0.12)_1px,transparent_1px,transparent_14px)] [background-size:100%_240px]" />
        {/* Scanlines */}
        <div className="absolute inset-0 opacity-30 [background-image:repeating-linear-gradient(180deg,var(--scan)_0px,var(--scan)_1px,transparent_2px,transparent_4px)]" />
        {/* Sweeping scanline */}
        <div className="terminal-scanline absolute -top-1/3 left-0 right-0 h-40 bg-gradient-to-b from-transparent via-[rgba(0,255,255,0.10)] to-transparent blur-sm" />
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.35)_55%,rgba(0,0,0,0.65)_100%)]" />
      </div>
      <div className="sticky top-0 z-50 border-b border-cyan-500/20 bg-[#0a0a0f]/85 backdrop-blur">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[rgba(0,255,255,0.12)] via-transparent to-[rgba(0,255,136,0.10)]" />
          <div className="flex items-center gap-3 px-4 py-3 text-[11px] text-slate-200 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 ring-1 ring-cyan-500/20 neon-border font-terminal">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  isConnected
                    ? "bg-emerald-400 animate-pulse shadow-[0_0_18px_rgba(16,185,129,1)]"
                    : "bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.6)]",
                ].join(" ")}
              />
              <span className="ticker-glow font-semibold text-slate-100">
                {isConnected ? "LIVE" : "SYNCING"}
              </span>
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="somnia-marquee flex w-[200%] items-center gap-10 whitespace-nowrap font-terminal">
                <div className="flex w-1/2 items-center gap-10">
                  <span className="ticker-glow text-slate-300">
                    SOMNIA • TESTNET
                  </span>
                  <span>
                    Total detected:{" "}
                    <span className="ticker-glow font-semibold text-slate-100">
                      {stats.totalTxs}
                    </span>
                  </span>
                  <span>
                    Total volume:{" "}
                    <span className="ticker-glow font-semibold text-[color:var(--neon)]">
                      {stats.totalVolumeFormatted}
                    </span>
                  </span>
                  <span>
                    Largest tx:{" "}
                    <span className="ticker-glow font-semibold text-[color:var(--cyan)]">
                      {stats.largestFormatted}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    Filter: {MIN_VALUE_LABEL}
                  </span>
                </div>
                <div className="flex w-1/2 items-center gap-10">
                  <span className="ticker-glow text-slate-300">
                    SOMNIA • TESTNET
                  </span>
                  <span>
                    Total detected:{" "}
                    <span className="ticker-glow font-semibold text-slate-100">
                      {stats.totalTxs}
                    </span>
                  </span>
                  <span>
                    Total volume:{" "}
                    <span className="ticker-glow font-semibold text-[color:var(--neon)]">
                      {stats.totalVolumeFormatted}
                    </span>
                  </span>
                  <span>
                    Largest tx:{" "}
                    <span className="ticker-glow font-semibold text-[color:var(--cyan)]">
                      {stats.largestFormatted}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    Filter: {MIN_VALUE_LABEL}
                  </span>
                </div>
              </div>
            </div>
            <div className="ticker-glow hidden shrink-0 text-[11px] text-slate-300 sm:block font-terminal">
              Last updated:{" "}
              <span className="font-semibold text-slate-200">
                {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString() : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="neon-border relative overflow-hidden rounded-2xl border bg-black/25 px-5 py-6 shadow-[0_18px_90px_rgba(0,255,255,0.08)] sm:px-8 sm:py-7">
          <div className="pointer-events-none absolute inset-0">
            <div className="somnia-hero-bg absolute -inset-24 opacity-60 blur-3xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_18%_20%,rgba(0,255,255,0.28),transparent_54%),radial-gradient(circle_at_80%_26%,rgba(0,255,136,0.18),transparent_52%),radial-gradient(circle_at_45%_85%,rgba(0,255,255,0.12),transparent_54%)]" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/50 to-black/80" />
          </div>

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="font-terminal inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-xs font-semibold text-[color:var(--cyan)] ring-1 ring-cyan-500/25">
                <span className="h-2 w-2 rounded-full bg-[color:var(--cyan)] shadow-[0_0_14px_rgba(0,255,255,0.85)]" />
                SOMNIA WHALE TRACKER
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
                Premium Trading Terminal
              </h1>
              <p className="max-w-2xl text-sm text-slate-400">
                A serious, cyberpunk-grade terminal feed for Somnia Testnet.
                Filter:{" "}
                <span className="font-terminal font-semibold text-[color:var(--neon)]">
                  {MIN_VALUE_LABEL}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-col items-end gap-3 text-sm">
              <div className="font-terminal inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 ring-1 ring-cyan-500/20 neon-border">
                <span
                  className={[
                    "h-2 w-2 rounded-full bg-[color:var(--neon)]",
                    isConnected
                      ? "shadow-[0_0_22px_rgba(0,255,136,1),0_0_44px_rgba(0,255,255,0.18)] [animation:neon-pulse_1.3s_ease-in-out_infinite]"
                      : "shadow-[0_0_12px_rgba(0,255,136,0.5)]",
                  ].join(" ")}
                />
                <span className="ticker-glow font-semibold text-slate-100">
                  {isConnected ? "LIVE" : "SYNCING"}
                </span>
              </div>
              <div className="font-terminal inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-xs text-slate-300 ring-1 ring-cyan-500/15">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--cyan)] shadow-[0_0_12px_rgba(0,255,255,0.75)]" />
                SOMNIA TESTNET • RPC PROXIED
              </div>
              <div className="font-terminal text-xs text-slate-400">
                Last updated:{" "}
                <span className="ticker-glow font-semibold text-slate-100">
                  {lastUpdatedAt ? lastUpdatedAt.toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </div>
        </header>

        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <div className="neon-border rounded-xl border bg-black/25 px-3 py-2 font-terminal">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Total
              </div>
              <div className="ticker-glow text-sm font-semibold text-slate-100">
                {stats.totalTxs}
              </div>
            </div>
            <div className="neon-border rounded-xl border bg-black/25 px-3 py-2 font-terminal">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Largest
              </div>
              <div className="ticker-glow text-sm font-semibold text-[color:var(--cyan)]">
                {stats.largestFormatted}
              </div>
            </div>
            <div className="neon-border rounded-xl border bg-black/25 px-3 py-2 font-terminal">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Volume
              </div>
              <div className="ticker-glow text-sm font-semibold text-[color:var(--neon)]">
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
            <div className="flex items-center gap-3 text-sm text-slate-300 font-terminal">
              <span className="neon-border inline-flex h-8 w-8 items-center justify-center rounded-full border bg-black/25 text-xs font-semibold text-[color:var(--cyan)]">
                {filteredEvents.length}
              </span>
              <span>
                Detected transactions (newest first).
              </span>
            </div>
            <button
              type="button"
              onClick={clearFeed}
              className="font-terminal inline-flex items-center justify-center rounded-full border border-cyan-500/25 bg-black/30 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-cyan-400/60 hover:text-[color:var(--cyan)] hover:shadow-[0_0_22px_rgba(0,255,255,0.18)] focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="font-terminal w-full rounded-xl border border-cyan-500/20 bg-black/30 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 shadow-[0_12px_40px_rgba(0,255,255,0.06)] outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/30"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="text"
              />
              {walletFilter.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setWalletFilter("")}
                  className="font-terminal absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-white/5 hover:text-[color:var(--cyan)] focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                  aria-label="Clear wallet filter"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="font-terminal text-xs text-slate-400 sm:text-right">
              Showing{" "}
              <span className="ticker-glow font-semibold text-slate-100">
                {filteredEvents.length}
              </span>{" "}
              of{" "}
              <span className="ticker-glow font-semibold text-slate-100">
                {events.length}
              </span>
            </div>
          </div>

          <div className="neon-border relative flex-1 overflow-hidden rounded-2xl border bg-black/20 shadow-[0_18px_90px_rgba(0,255,255,0.07)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[rgba(0,255,255,0.16)] via-transparent to-transparent blur-2xl" />

            <div className="relative h-full">
              <div className="font-terminal grid grid-cols-[16px_minmax(0,2.6fr)_minmax(0,1.6fr)_minmax(0,3fr)_minmax(0,1.7fr)] gap-3 border-b border-cyan-500/15 bg-black/30 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:px-6">
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
                        className="somnia-row-enter group rounded-md border border-cyan-500/10 bg-black/25 px-3 py-1.5 text-[11px] text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] transition hover:border-cyan-400/40 hover:bg-black/35 sm:px-4"
                      >
                        <div className="font-terminal grid grid-cols-[16px_minmax(0,2.6fr)_minmax(0,1.6fr)_minmax(0,3fr)_minmax(0,1.7fr)] items-center gap-3">
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
                              className="min-w-0 truncate text-[11px] text-slate-200 underline-offset-2 transition hover:text-[color:var(--cyan)] hover:underline hover:shadow-[0_0_18px_rgba(0,255,255,0.25)]"
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
                              className="truncate text-[11px] text-slate-400 underline-offset-2 transition hover:text-[color:var(--cyan)] hover:underline hover:shadow-[0_0_18px_rgba(0,255,255,0.25)]"
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
