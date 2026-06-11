import AppShell from "@/components/AppShell";

export default function ProfilePage() {
  return (
    <AppShell>
      <div className="p-6 text-white">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "'ClashDisplay', sans-serif" }}
        >
          Profile
        </h1>
        <p className="text-gray-400 text-sm">
          User profile — wired in CEO-2 (task #11).
        </p>
      </div>
    </AppShell>
  );
}
