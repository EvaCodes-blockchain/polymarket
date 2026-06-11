import Image from "next/image";
import Link from "next/link";
import MarketCard from "./MarketCard";
import { formatCount, type PostDTO } from "@/lib/client/api";

/**
 * @deprecated Legacy prototype shape — kept exported only so the retired
 * `@/lib/client/feedData` module (unused, owned elsewhere) still typechecks.
 * New code renders `PostDTO` from `@/lib/client/api`.
 */
export interface FeedPost {
  id: string;
  authorName: string;
  authorHandle: string;
  authorImg: string;
  verified?: boolean;
  date: string;
  text: string;
  likes: string;
  comments: string;
  reposts: string;
  market?: {
    id: string;
    title: string;
    description: string;
    volume: string;
    closeTime: string;
    chancePct: number;
    thumbSrc: string;
    outcomeYes: string;
    outcomeNo: string;
    priceYes: number;
    priceNo: number;
    tradeHref?: string;
  };
  commentList?: {
    id: string;
    authorName: string;
    authorImg: string;
    text: string;
    time: string;
  }[];
}

const FALLBACK_AVATAR = "/img/download.jpeg";

/** "19 Feb"-style short date from an ISO timestamp. */
function formatPostDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

interface FeedItemProps {
  post: PostDTO;
}

export default function FeedItem({ post }: FeedItemProps) {
  const authorName = post.author.name ?? post.author.handle ?? "Unknown";
  const avatarSrc = post.author.image ?? FALLBACK_AVATAR;
  const profileHref = post.author.handle
    ? `/profile/${post.author.handle}`
    : "/profile";

  return (
    <div className="border-b border-white/10 py-3 px-4 xl:px-6">
      <div className="bg-glass rounded-2xl p-4 shadow-sm">
        <div className="flex gap-3">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <Image
              src={avatarSrc}
              alt={authorName}
              width={40}
              height={40}
              className="rounded-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <Link
                href={profileHref}
                className="flex items-center gap-1 no-underline"
              >
                <span className="font-bold text-white text-sm">
                  {authorName}
                </span>
                <span className="material-icons bg-indigo-600 md-16 text-white rounded-full leading-none">
                  done
                </span>
                {post.author.handle && (
                  <span className="text-gray-400 text-xs ml-1">
                    @{post.author.handle}
                  </span>
                )}
              </Link>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>{formatPostDate(post.createdAt)}</span>
                {/* Options dropdown — static in this task */}
                <button className="material-icons md-20 text-gray-400 hover:text-white rounded-full bg-glass p-1 transition-colors">
                  more_vert
                </button>
              </div>
            </div>

            {/* Text */}
            <p className="text-white text-sm mb-3 leading-relaxed">{post.text}</p>

            {/* Embedded market card */}
            {post.market && (
              <div className="mb-3">
                <MarketCard market={post.market} />
              </div>
            )}

            {/* Engagement */}
            <div className="flex items-center justify-between text-gray-400 text-xs mb-3">
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">thumb_up_off_alt</span>
                <span>{formatCount(post.likeCount)}</span>
              </button>
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">chat_bubble_outline</span>
                <span>{formatCount(post.commentCount)}</span>
              </button>
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">repeat</span>
                <span>{formatCount(post.repostCount)}</span>
              </button>
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">share</span>
                <span>Share</span>
              </button>
            </div>

            {/* Comment input */}
            <div className="flex items-center gap-2">
              <span className="material-icons text-indigo-400 md-32">
                account_circle
              </span>
              <input
                type="text"
                placeholder="Write Your comment"
                className="flex-1 bg-glass rounded-xl border border-white/10 px-3 py-1.5 text-sm
                           text-white placeholder-gray-500 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
