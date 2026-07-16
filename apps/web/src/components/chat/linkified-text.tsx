"use client";

import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<>"'）】\]，。；、！？]+)/g;

const trimTrailingPunct = (url: string): string =>
    url.replace(/[),.;:!?，。；、！？]+$/u, "");

/** 将纯文本中的 http(s) URL 渲染为新标签页超链接 */
export const LinkifiedText = ({
    text,
    className,
}: {
    text: string;
    className?: string;
}): ReactNode => {
    if (!text) return null;
    const parts = text.split(URL_RE);
    return (
        <span className={className}>
            {parts.map((part, i) => {
                if (!part) return null;
                if (/^https?:\/\//i.test(part)) {
                    const href = trimTrailingPunct(part);
                    const trailing = part.slice(href.length);
                    return (
                        <span key={`u-${i}`}>
                            <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-[#2563eb] underline underline-offset-2 hover:text-[#1d4ed8]"
                            >
                                {href}
                            </a>
                            {trailing}
                        </span>
                    );
                }
                return <span key={`t-${i}`}>{part}</span>;
            })}
        </span>
    );
};
