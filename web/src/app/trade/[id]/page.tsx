import AppShell from "@/components/AppShell";

interface TradePageProps {
  params: { id: string };
}

export default function TradePage({ params }: TradePageProps) {
  return (
    <AppShell>
      <div className="p-6 text-white">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "'ClashDisplay', sans-serif" }}
        >
          Trade: {params.id}
        </h1>
        <p className="text-gray-400 text-sm">
          Full trading page — wired in CEO-4 (task #14).
        </p>
      </div>
    </AppShell>
  );
}
