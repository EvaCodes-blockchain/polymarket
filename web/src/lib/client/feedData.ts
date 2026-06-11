import type { FeedPost } from "@/components/FeedItem";

/** Hard-coded seed posts matching prototype index.html */
export const FEED_POSTS: FeedPost[] = [
  {
    id: "post-1",
    authorName: "FC Barcelona",
    authorHandle: "@barcelona",
    authorImg: "/img/barcelona.png",
    verified: true,
    date: "19 Feb",
    text: "El Clasico - Barcelona vs Real Madrid!\n Who will win?",
    likes: "30.4k",
    comments: "4.0k",
    reposts: "617",
    market: {
      id: "el-clasico",
      title: "Barcelona vs Real Madrid",
      description:
        "History, blood, and goals — welcome to the most watched 90 minutes in football.",
      volume: "$6M Vol.",
      closeTime: "23.08.2025 18.00",
      chancePct: 21,
      thumbSrc: "/img/el-classico.png",
      outcomeYes: "Barcelona",
      outcomeNo: "RealMadrid",
      priceYes: 0.21,
      priceNo: 0.8,
      tradeHref: "/trade/el-clasico",
    },
    commentList: [
      {
        id: "c1",
        authorName: "Leo Messi",
        authorImg: "/img/leo.jpg",
        text: "I really miss El Clásico.",
        time: "1h",
      },
      {
        id: "c2",
        authorName: "FC Atlético de Madrid",
        authorImg: "/img/Atletico_Madrid_logo.svg.png",
        text: "next one with us!! Good luck teams",
        time: "20min",
      },
    ],
  },
  {
    id: "post-2",
    authorName: "vitalik.eth",
    authorHandle: "@VitalikButerin",
    authorImg: "/img/vitalik.jpg",
    verified: true,
    date: "23 August",
    text: "Would you like me to launch the next market on the topic of the new ETH network update?\n\nVote with your likes and comments.",
    likes: "2.4k",
    comments: "250",
    reposts: "117",
    commentList: [
      {
        id: "c3",
        authorName: "Shayne Coplan",
        authorImg: "/img/1605931037447.jpeg",
        text: "Absolutely not! You promised you would trade on Polymarket!",
        time: "1h",
      },
      {
        id: "c4",
        authorName: "Cobie",
        authorImg: "/img/zVpm_8at_400x400.jpg",
        text: "Get started, I'll help with advertising! :)",
        time: "20min",
      },
      {
        id: "c5",
        authorName: "satoshi",
        authorImg: "/img/download.jpeg",
        text: "send me btc plsssss..",
        time: "10min",
      },
    ],
  },
];

/** Carousel creators matching prototype */
export const FOLLOW_CREATORS = [
  {
    name: "FC Real Madrid",
    descriptor: "Football club",
    img: "/img/real-madrid_416x416.jpg",
    handle: "real-madrid",
  },
  {
    name: "vitalik.eth",
    descriptor: "Enthusiast",
    img: "/img/vitalik.jpg",
    handle: "vitalik",
  },
  {
    name: "Leo Messi",
    descriptor: "Football player",
    img: "/img/leo.jpg",
    handle: "leo",
  },
  {
    name: "Cobie",
    descriptor: "Influencer",
    img: "/img/zVpm_8at_400x400.jpg",
    handle: "cobie",
  },
  {
    name: "satoshi",
    descriptor: "Blogger",
    img: "/img/download.jpeg",
    handle: "satoshi",
  },
] as const;
