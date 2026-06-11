"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import FeedItem from "./FeedItem";
import FollowButton from "./FollowButton";
import {
  fetchPosts,
  fetchUsers,
  type PostDTO,
  type UserSummaryDTO,
} from "@/lib/client/api";

type Tab = "feed" | "people" | "trending";

const FALLBACK_AVATAR = "/img/download.jpeg";
const PAGE_SIZE = 20;

function creatorProfileHref(user: UserSummaryDTO): string {
  return user.handle ? `/profile/${user.handle}` : "/profile";
}

function creatorDescriptor(user: UserSummaryDTO): string {
  if (user.bio) return user.bio;
  if (user.handle) return `@${user.handle}`;
  return "";
}

export default function FeedPage() {
  const [activeTab, setActiveTab] = useState<Tab>("feed");

  // ── Posts state ────────────────────────────────────────────────────────────
  const [posts, setPosts] = useState<PostDTO[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const spinnerRef = useRef<HTMLDivElement | null>(null);

  // ── Users state ────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserSummaryDTO[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Initial posts page
  useEffect(() => {
    let cancelled = false;
    fetchPosts({ limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
        setNextCursor(data.nextCursor);
        nextCursorRef.current = data.nextCursor;
        setPostsLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPostsError(err instanceof Error ? err.message : "Failed to load feed");
        setPostsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Users (carousel + People tab)
  useEffect(() => {
    let cancelled = false;
    fetchUsers({ limit: 12, order: "followers" })
      .then((data) => {
        if (cancelled) return;
        setUsers(data.users);
        setUsersLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUsersError(
          err instanceof Error ? err.message : "Failed to load creators",
        );
        setUsersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Next pages — infinite scroll
  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    fetchPosts({ cursor, limit: PAGE_SIZE })
      .then((data) => {
        setPosts((prev) => [...prev, ...data.posts]);
        setNextCursor(data.nextCursor);
        nextCursorRef.current = data.nextCursor;
      })
      .catch(() => {
        // Stop paginating on error; initial content stays on screen.
        setNextCursor(null);
        nextCursorRef.current = null;
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, []);

  // IntersectionObserver on the spinner div
  useEffect(() => {
    const el = spinnerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, activeTab, postsLoaded, nextCursor]);

  const renderCreatorCarousel = () => (
    <div className="px-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h6 className="font-bold text-white text-sm mb-0">Follow Creators</h6>
        <button className="material-icons text-white md-20">east</button>
      </div>
      {usersError ? (
        <p className="text-gray-500 text-xs">Creators unavailable right now.</p>
      ) : !usersLoaded ? (
        <p className="text-gray-500 text-xs">Loading creators…</p>
      ) : users.length === 0 ? (
        <p className="text-gray-500 text-xs">No creators to follow yet.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex-shrink-0 bg-glass rounded-2xl p-3 flex flex-col items-center min-w-[100px] shadow-sm"
            >
              <div className="relative mb-2">
                <Link href={creatorProfileHref(user)}>
                  <Image
                    src={user.image ?? FALLBACK_AVATAR}
                    alt={user.name ?? user.handle ?? "Creator"}
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
                {user.name ?? user.handle ?? "Unknown"}
              </p>
              <p className="text-gray-400 text-xs text-center mb-2">
                {creatorDescriptor(user)}
              </p>
              <FollowButton
                userId={user.id}
                initialFollowing={user.viewerFollows}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPostsList = () => {
    if (postsError) {
      return (
        <p className="text-center text-gray-500 text-sm py-8">
          Couldn&apos;t load the feed. Please try again later.
        </p>
      );
    }
    if (!postsLoaded) {
      return (
        <p className="text-center text-gray-500 text-sm py-8">Loading feed…</p>
      );
    }
    if (posts.length === 0) {
      return (
        <p className="text-center text-gray-500 text-sm py-8">
          No posts yet — be the first to post.
        </p>
      );
    }
    return posts.map((post) => <FeedItem key={post.id} post={post} />);
  };

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
          {renderCreatorCarousel()}

          {/* Feed posts */}
          <div className="feeds">{renderPostsList()}</div>

          {/* Infinite scroll indicator */}
          {postsLoaded && !postsError && nextCursor !== null && (
            <div ref={spinnerRef} className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </>
      )}

      {/* People tab */}
      {activeTab === "people" && (
        <div className="px-4">
          <h6 className="font-bold text-white text-sm mb-3">
            People you can follow
          </h6>
          {usersError ? (
            <p className="text-center text-gray-500 text-sm py-8">
              Couldn&apos;t load people. Please try again later.
            </p>
          ) : !usersLoaded ? (
            <p className="text-center text-gray-500 text-sm py-8">
              Loading people…
            </p>
          ) : users.length === 0 ? (
            <p className="text-center text-gray-500 text-sm py-8">
              Nobody to follow yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="bg-glass rounded-2xl p-4 flex items-center gap-3 shadow-sm"
                >
                  <Link
                    href={creatorProfileHref(user)}
                    className="flex-shrink-0"
                  >
                    <Image
                      src={user.image ?? FALLBACK_AVATAR}
                      alt={user.name ?? user.handle ?? "Creator"}
                      width={48}
                      height={48}
                      className="rounded-full object-cover"
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm mb-0">
                      {user.name ?? user.handle ?? "Unknown"}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {creatorDescriptor(user)}
                    </p>
                  </div>
                  <FollowButton
                    userId={user.id}
                    initialFollowing={user.viewerFollows}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trending tab */}
      {activeTab === "trending" && (
        <div className="px-4">
          <h6 className="font-bold text-white text-sm mb-3">Trending</h6>
          {renderPostsList()}
        </div>
      )}
    </div>
  );
}
