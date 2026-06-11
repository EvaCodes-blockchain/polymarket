import Image from "next/image";
import Link from "next/link";
import MarketCard, { type MarketCardData } from "./MarketCard";

export interface Comment {
  id: string;
  authorName: string;
  authorImg: string;
  text: string;
  time: string;
}

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
  market?: MarketCardData;
  commentList?: Comment[];
}

interface FeedItemProps {
  post: FeedPost;
}

export default function FeedItem({ post }: FeedItemProps) {
  return (
    <div className="border-b border-white/10 py-3 px-4 xl:px-6">
      <div className="bg-glass rounded-2xl p-4 shadow-sm">
        <div className="flex gap-3">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <Image
              src={post.authorImg}
              alt={post.authorName}
              width={40}
              height={40}
              className="rounded-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <Link
                href="/profile"
                className="flex items-center gap-1 no-underline"
              >
                <span className="font-bold text-white text-sm">
                  {post.authorName}
                </span>
                {post.verified && (
                  <span className="material-icons bg-indigo-600 md-16 text-white rounded-full leading-none">
                    done
                  </span>
                )}
                <span className="text-gray-400 text-xs ml-1">
                  {post.authorHandle}
                </span>
              </Link>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>{post.date}</span>
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
                <span>{post.likes}</span>
              </button>
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">chat_bubble_outline</span>
                <span>{post.comments}</span>
              </button>
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">repeat</span>
                <span>{post.reposts}</span>
              </button>
              <button className="flex items-center gap-1 hover:text-white transition-colors">
                <span className="material-icons md-18">share</span>
                <span>Share</span>
              </button>
            </div>

            {/* Comment input */}
            <div className="flex items-center gap-2 mb-3">
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

            {/* Comments */}
            {post.commentList && post.commentList.length > 0 && (
              <div className="space-y-2">
                {post.commentList.map((c) => (
                  <div key={c.id} className="flex gap-2">
                    <Image
                      src={c.authorImg}
                      alt={c.authorName}
                      width={28}
                      height={28}
                      className="rounded-full object-cover flex-shrink-0"
                    />
                    <div>
                      <div className="bg-glass rounded-2xl px-3 py-2 mb-1">
                        <p className="font-medium text-white text-xs mb-0">
                          {c.authorName}
                        </p>
                        <span className="text-gray-400 text-xs">{c.text}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 ml-2">
                        <button className="hover:text-white transition-colors">Like</button>
                        <span className="material-icons" style={{ fontSize: 4 }}>
                          circle
                        </span>
                        <button className="hover:text-white transition-colors">Reply</button>
                        <span className="material-icons" style={{ fontSize: 4 }}>
                          circle
                        </span>
                        <span>{c.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
