import AppShell from "@/components/AppShell";

export default function MarketsPage() {
  return (
    <AppShell>
      <div className="p-6 text-white">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "'ClashDisplay', sans-serif" }}
        >
          Markets
        </h1>
        <p className="text-gray-400 text-sm">
          Market discovery — coming soon.
        </p>
      </div>
    </AppShell>
  );
}
