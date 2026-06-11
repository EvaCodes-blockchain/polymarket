import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-brown-gradient flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="text-8xl font-bold text-indigo-500 opacity-30">404</div>
      <h1
        className="text-3xl font-bold text-white"
        style={{ fontFamily: "'ClashDisplay', sans-serif" }}
      >
        Oh no! Where did you go?
      </h1>
      <p className="text-gray-400 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors no-underline"
      >
        Go back to safety
      </Link>
    </div>
  );
}
