import type { NextConfig } from "next";

const matcherDestination = "/application-copilot";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.hirescore.in" }],
        destination: "https://hirescore.in/:path*",
        permanent: true,
      },
      {
        source: "/analysis",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/upload",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/pricing",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/instant-fit",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/instant-fit/:path*",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/guided-flow",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/tools",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/features",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/features/:path*",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/resources",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/resources/:path*",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/case-studies",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/growth-kit",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/interview-prep",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/interview-simulator",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/interview-copilot",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/studio",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/ai-resume-studio",
        destination: matcherDestination,
        permanent: true,
      },
      {
        source: "/dashboard",
        destination: matcherDestination,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
