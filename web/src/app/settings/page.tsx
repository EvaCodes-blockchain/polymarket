import AppShell from "@/components/AppShell";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="p-6 text-white">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "'ClashDisplay', sans-serif" }}
        >
          Settings
        </h1>
        <p className="text-gray-400 text-sm">
          Edit profile &amp; settings — coming soon.
        </p>
      </div>
    </AppShell>
  );
}
