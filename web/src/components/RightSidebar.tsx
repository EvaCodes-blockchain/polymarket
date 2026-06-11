"use client";

import Link from "next/link";
import Image from "next/image";
import FollowButton from "./FollowButton";

const MARKET_MOVERS = [
  {
    handle: "@FC Barcelona",
    title: "El Clasico - Barcelona vs Real Madrid! Who will win?",
    tags: "#barcelona #elclassico",
    img: "/img/el-classico.png",
  },
  {
    handle: "@Founder",
    title: "Russia x Ukraine ceasefire in 2025?",
    tags: "#war #ukraine",
    img: "/img/russia-x-ukraine-ceasefire-in-2025-w2voYOygx80B.webp",
  },
  {
    handle: "@VitalikButerin",
    title: "Ethereum price on August 18?",
    tags: "#crypto #eth",
    img: "/img/ETHfullsize.webp",
  },
  {
    handle: "@polytics",
    title: "Will MicroStrategy purchase Bitcoin August 12-18?",
    tags: "#crypto #btc",
    img: "/img/will-microstrategy-purchase-bitcoin-july-1-7-mzoE5TYk_cCI.webp",
  },
] as const;

const WHO_TO_FOLLOW = [
  {
    name: "Shay Coplan",
    handle: "@shayne_c",
    descriptor: "Promoted",
    img: "/img/1605931037447.jpeg",
    verified: true,
  },
  {
    name: "Cobie",
    handle: "@cobie",
    descriptor: "Influencer",
    img: "/img/zVpm_8at_400x400.jpg",
    verified: true,
  },
  {
    name: "Leo Messi",
    handle: "@leo",
    descriptor: "Football Player",
    img: "/img/leo.jpg",
    verified: true,
  },
] as const;

export default function RightSidebar() {
  return (
    <aside className="col-span-3 hidden xl:block">
      <div className="fix-sidebar pl-3 py-3 sticky top-0 h-screen overflow-y-auto">
        {/* Search */}
        <div className="mb-4">
          <div className="flex items-center gap-2 bg-glass rounded-2xl px-4 py-2 shadow-sm">
            <span className="material-icons md-20 text-indigo-400">search</span>
            <input
              type="text"
              placeholder="Search Justify"
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 text-sm"
            />
          </div>
        </div>

        {/* Market Movers */}
        <div className="bg-glass rounded-2xl overflow-hidden shadow-sm mb-4">
          <h6 className="font-bold text-white p-3 mb-0 border-b border-white/10 text-sm">
            Market Movers
          </h6>
          {MARKET_MOVERS.map((item) => (
            <Link
              key={item.title}
              href="/markets"
              className="p-3 border-b border-white/10 flex items-center gap-3 no-underline
                         hover:bg-white/5 transition-colors trending-item"
            >
              <div className="flex-1 min-w-0">
                <div className="text-gray-400 text-xs flex items-center gap-1 mb-1">
                  <span>{item.handle}</span>
                  <span className="material-icons" style={{ fontSize: 6 }}>
                    circle
                  </span>
                  <span className="text-green-400">Live</span>
                </div>
                <p className="font-semibold text-white text-xs mb-1 pr-2 line-clamp-2">
                  {item.title}
                </p>
                <span className="text-xs text-gray-500">Trending with </span>
                <span className="text-xs text-indigo-400">{item.tags}</span>
              </div>
              <Image
                src={item.img}
                alt={item.title}
                width={56}
                height={56}
                className="rounded-xl object-cover flex-shrink-0"
              />
            </Link>
          ))}
          <Link
            href="/markets"
            className="block p-3 text-indigo-400 text-sm hover:underline no-underline"
          >
            Show More
          </Link>
        </div>

        {/* Who to Follow */}
        <div className="bg-glass rounded-2xl overflow-hidden shadow-sm mb-4">
          <h6 className="font-bold text-white p-3 mb-0 border-b border-white/10 text-sm">
            Who to follow
          </h6>
          {WHO_TO_FOLLOW.map((person, i) => (
            <div
              key={person.handle}
              className={`p-3 flex items-center gap-3 account-item
                ${i < WHO_TO_FOLLOW.length - 1 ? "border-b border-white/10" : ""}`}
            >
              <Link href="/profile" className="flex-shrink-0">
                <Image
                  src={person.img}
                  alt={person.name}
                  width={40}
                  height={40}
                  className="rounded-full object-cover"
                />
              </Link>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-xs mb-0 flex items-center gap-1">
                  <Link
                    href="/profile"
                    className="no-underline text-white hover:underline"
                  >
                    {person.name}
                  </Link>
                  {person.verified && (
                    <span className="material-icons bg-indigo-600 md-16 text-white rounded-full p-0 leading-none">
                      done
                    </span>
                  )}
                </p>
                <p className="text-gray-500 text-xs mb-0">{person.handle}</p>
                <span className="text-gray-500 text-xs">{person.descriptor}</span>
              </div>
              <FollowButton userId={person.handle} />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
