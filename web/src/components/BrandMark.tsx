export default function BrandMark({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <div
      className={`${className} relative overflow-hidden rounded-[1.15rem] border border-[hsl(var(--border)/0.6)] bg-[linear-gradient(145deg,#2c211c_0%,#8d5a42_52%,#efc7a3_100%)] shadow-[0_18px_34px_rgba(72,46,33,0.18)]`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_22%,rgba(255,255,255,0.42),transparent_28%),linear-gradient(to_bottom,transparent,rgba(20,12,8,0.18))]" />
      <div className="absolute left-[24%] top-[22%] h-[56%] w-[18%] rounded-full bg-white/92 shadow-[0_0_12px_rgba(255,255,255,0.28)]" />
      <div className="absolute left-[41%] top-[22%] h-[56%] w-[18%] rounded-full bg-white/76" />
      <div className="absolute left-[58%] top-[22%] h-[56%] w-[18%] rounded-full bg-white/56" />
      <div className="absolute bottom-[18%] left-[18%] right-[18%] h-[12%] rounded-full bg-[rgba(48,28,18,0.28)] blur-[1px]" />
      <div className="absolute inset-x-[22%] top-[18%] h-[64%] rounded-[999px] border border-white/18" />
    </div>
  );
}
