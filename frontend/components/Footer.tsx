export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#0a0a0f]">
      <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          © {new Date().getFullYear()} The Odyssey. All rights reserved.
        </p>
        <a
          href="mailto:Tex@theodyssey.fun"
          className="text-sm text-zinc-400 hover:text-white transition-colors"
        >
          Contact Us: Tex@theodyssey.fun
        </a>
      </div>
    </footer>
  )
}
