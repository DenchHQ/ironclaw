"use client";

import Link from "next/link";

// Three dramatic slash marks — like a panther raking its claws
const CLAW_ASCII = [
  "                                                                                          ░░░░",
  "                                                                                        ░░░░░░",
  "                                         ░░░░                                          ░░░░░░░",
  "                                       ░░░░░░                            ░░░░         ░░░▓▓░░░",
  "                          ░░░░        ░░░░░░░                          ░░░░░░        ░░▓▓▓▓░░░",
  "                        ░░░░░░       ░░░▓▓░░░              ░░░░       ░░░░░░░       ░░▓▓▓▓▓░░ ",
  "                       ░░░░░░░      ░░▓▓▓▓░░░            ░░░░░░      ░░░▓▓░░░     ░░▓▓▓▓▓░░  ",
  "                      ░░░▓▓░░░     ░░▓▓▓▓▓░░            ░░░░░░░     ░░▓▓▓▓░░░    ░▓▓▓▓▓▓░░   ",
  "                     ░░▓▓▓▓░░░    ░░▓▓▓▓▓░░            ░░░▓▓░░░    ░░▓▓▓▓▓░░    ░▓▓▓▓▓▓░░    ",
  "                    ░░▓▓▓▓▓░░    ░▓▓▓▓▓▓░░            ░░▓▓▓▓░░░   ░░▓▓▓▓▓░░    ▓▓▓▓▓▓░░     ",
  "                   ░░▓▓▓▓▓░░    ░▓▓▓▓▓▓░░            ░░▓▓▓▓▓░░   ░▓▓▓▓▓▓░░    ▓▓▓▓▓▓░░      ",
  "                  ░░▓▓▓▓▓░░    ▓▓▓▓▓▓░░             ░░▓▓▓▓▓░░    ░▓▓▓▓▓░░    ▓▓▓▓▓░░░       ",
  "                 ░▓▓▓▓▓▓░░    ▓▓▓▓▓▓░░             ░░▓▓▓▓▓░░    ▓▓▓▓▓▓░░    ▓▓▓▓▓░░         ",
  "                ░▓▓▓▓▓▓░░    ▓▓▓▓▓░░░             ░▓▓▓▓▓▓░░    ▓▓▓▓▓▓░░    ▓▓▓▓▓░░          ",
  "               ░▓▓▓▓▓▓░░   ▓▓▓▓▓░░              ░▓▓▓▓▓▓░░    ▓▓▓▓▓░░░   ▓▓▓▓▓░░            ",
  "              ░▓▓▓▓▓░░░   ▓▓▓▓▓░░              ░▓▓▓▓▓▓░░    ▓▓▓▓▓░░    ▓▓▓▓▓░░             ",
  "             ░▓▓▓▓▓░░    ▓▓▓▓░░░              ░▓▓▓▓▓░░░    ▓▓▓▓▓░░    ▓▓▓▓░░░              ",
  "            ░▓▓▓▓▓░░    ▓▓▓▓░░              ░░▓▓▓▓▓░░     ▓▓▓▓░░░   ▓▓▓▓░░                ",
  "           ░▓▓▓▓░░░   ▓▓▓▓░░              ░░▓▓▓▓▓░░      ▓▓▓▓░░    ▓▓▓▓░░                 ",
  "          ░▓▓▓▓░░    ▓▓▓░░░              ░▓▓▓▓▓░░░      ▓▓▓▓░░    ▓▓▓░░░                  ",
  "         ░▓▓▓▓░░    ▓▓▓░░              ░░▓▓▓▓░░        ▓▓▓░░░   ▓▓▓░░                    ",
  "        ░▓▓▓░░░    ▓▓░░░              ░▓▓▓▓░░░        ▓▓▓░░    ▓▓▓░░                     ",
  "       ░▓▓▓░░     ▓▓░░              ░░▓▓▓░░          ▓▓░░░    ▓▓░░░                      ",
  "      ░▓▓░░░    ░▓░░              ░░▓▓▓░░           ▓▓░░     ▓▓░░                        ",
  "     ░▓▓░░     ░▓░░              ░▓▓▓░░░          ░▓░░░    ░▓░░                          ",
  "    ░▓░░░     ░░░               ░▓▓░░            ░▓░░     ░▓░░                           ",
  "   ░▓░░      ░░               ░░▓░░░           ░░░░     ░░░░                             ",
  "  ░░░░      ░                ░░▓░░             ░░░      ░░░                              ",
  "  ░░░                       ░░░░░              ░░       ░░                               ",
  " ░░                         ░░░               ░                                          ",
  " ░                          ░░                                                           ",
];

const IRONCLAW_ASCII = [
  " ██╗██████╗  ██████╗ ███╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗",
  " ██║██╔══██╗██╔═══██╗████╗  ██║██╔════╝██║     ██╔══██╗██║    ██║",
  " ██║██████╔╝██║   ██║██╔██╗ ██║██║     ██║     ███████║██║ █╗ ██║",
  " ██║██╔══██╗██║   ██║██║╚██╗██║██║     ██║     ██╔══██║██║███╗██║",
  " ██║██║  ██║╚██████╔╝██║ ╚████║╚██████╗███████╗██║  ██║╚███╔███╔╝",
  " ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ",
];

export default function Home() {
  return (
    <>
      <style>{`
        @keyframes iron-shimmer {
          0% {
            background-position: -200% center;
          }
          100% {
            background-position: 200% center;
          }
        }

        .ascii-banner {
          font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono",
            "Courier New", monospace;
          white-space: pre;
          line-height: 1.15;
          font-size: clamp(0.5rem, 1.8vw, 1.4rem);
          background: linear-gradient(
            90deg,
            #374151 0%,
            #4b5563 10%,
            #6b7280 20%,
            #9ca3af 30%,
            #d1d5db 40%,
            #f3f4f6 50%,
            #d1d5db 60%,
            #9ca3af 70%,
            #6b7280 80%,
            #4b5563 90%,
            #374151 100%
          );
          background-size: 200% 100%;
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: iron-shimmer 2.5s ease-in-out infinite;
        }
      `}</style>

      <div className="relative flex flex-col items-center justify-center min-h-screen bg-stone-50 overflow-hidden px-4">
        {/* Claw slash marks as full background — hidden on small screens */}
        <div
          className="absolute inset-0 hidden md:flex items-center justify-center select-none pointer-events-none text-stone-200/40"
          style={{
            fontFamily: '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", "Courier New", monospace',
            whiteSpace: "pre",
            lineHeight: 1.0,
            fontSize: "clamp(0.75rem, 1.6vw, 1.5rem)",
          }}
        >
          {CLAW_ASCII.join("\n")}
        </div>

        {/* Foreground content */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="ascii-banner select-none hidden sm:block" aria-label="IRONCLAW">
            {IRONCLAW_ASCII.join("\n")}
          </div>
          <h1 className="sm:hidden text-3xl font-bold text-stone-600" style={{ fontFamily: "monospace" }}>
            IRONCLAW
          </h1>
          <Link
            href="/workspace"
            className="mt-10 text-lg text-stone-400 hover:text-stone-600 transition-all min-h-[44px] flex items-center"
            style={{ fontFamily: "monospace" }}
          >
            enter the app &rarr;
          </Link>
        </div>
      </div>
    </>
  );
}
