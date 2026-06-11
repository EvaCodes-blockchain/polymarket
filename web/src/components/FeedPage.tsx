"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import FeedItem from "./FeedItem";
import FollowButton from "./FollowButton";
import { FEED_POSTS, FOLLOW_CREATORS } from "@/lib/client/feedData";

type Tab = "feed" | "people" | "trending";

export default function FeedPage() {
  const [activeTab, setActiveTab] = useState<Tab>("feed");

  return (
    <div className="main-content">
      {/* Tab strip */}
      <div className="sticky top-0 z-20 m-3 mb-4">
        <ul className="flex bg-dark-glass rounded-2xl overflow-hidden shadow-sm">
          {(["feed", "people", "trending"] as Tab[]).map((tab) => (
            <li key={tab} className="flex-1">
              <button
                onClick={() => setActiveTab(tab)}
                className={`w-full py-3 text-sm font-medium capitalize transition-colors
                  ${
                    activeTab === tab
                      ? "text-white bg-white/10"
                      : "text-gray-400 hover:text-white"
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Feed tab */}
      {activeTab === "feed" && (
        <>
          {/* Post composer trigger */}
          <div className="px-4 mb-4">
            <div className="flex items-center gap-2 bg-glass rounded-2xl px-4 py-2 shadow-sm cursor-pointer">
              <span className="material-icons text-indigo-400">
                account_circle
              </span>
              <span className="text-gray-500 text-sm flex-1">
                Post your crypto ideas
              </span>
              <span className="material-icons text-indigo-400">add_circle</span>
            </div>
          </div>

          {/* Follow Creators carousel */}
          <div className="px-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h6 className="font-bold text-white text-sm mb-0">
                Follow Creators
              </h6>
              <button className="material-icons text-white md-20">east</button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {FOLLOW_CREATORS.map((creator) => (
                <div
                  key={creator.handle}
                  className="flex-shrink-0 bg-glass rounded-2xl p-3 flex flex-col items-center min-w-[100px] shadow-sm"
                >
                  <div className="relative mb-2">
                    <Link href="/profile">
                      <Image
                        src={creator.img}
                        alt={creator.name}
                        width={56}
                        height={56}
                        className="rounded-full object-cover"
                      />
                    </Link>
                    <div className="absolute -bottom-1 -right-1 bg-indigo-600 rounded-full p-0.5">
                      <span className="material-icons md-16 text-white leading-none">
                        done
                      </span>
                    </div>
                  </div>
                  <p className="font-bold text-white text-xs text-center mb-0.5 leading-tight">
                    {creator.name}
                  </p>
                  <p className="text-gray-400 text-xs text-center mb-2">
                    {creator.descriptor}
                  </p>
                  <FollowButton userId={creator.handle} />
                </div>
              ))}
            </div>
          </div>

          {/* Feed posts */}
          <div className="feeds">
            {FEED_POSTS.map((post) => (
              <FeedItem key={post.id} post={post} />
            ))}
          </div>

          {/* Infinite scroll indicator */}
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </>
      )}

      {/* People tab */}
      {activeTab === "people" && (
        <div className="px-4">
          <h6 className="font-bold text-white text-sm mb-3">
            People you can follow
          </h6>
          <div className="grid grid-cols-1 gap-3">
            {FOLLOW_CREATORS.map((creator) => (
              <div
                key={creator.handle}
                className="bg-glass rounded-2xl p-4 flex items-center gap-3 shadow-sm"
              >
                <Link href="/profile" className="flex-shrink-0">
                  <Image
                    src={creator.img}
                    alt={creator.name}
                    width={48}
                    height={48}
                    className="rounded-full object-cover"
                  />
                </Link>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm mb-0">
                    {creator.name}
                  </p>
                  <p className="text-gray-400 text-xs">{creator.descriptor}</p>
                </div>
                <FollowButton userId={creator.handle} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trending tab */}
      {activeTab === "trending" && (
        <div className="px-4">
          <h6 className="font-bold text-white text-sm mb-3">Trending</h6>
          {FEED_POSTS.map((post) => (
            <FeedItem key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
