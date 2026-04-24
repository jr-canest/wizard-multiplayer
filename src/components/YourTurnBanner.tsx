type Props = {
  text: string;
};

export function YourTurnBanner({ text }: Props) {
  return (
    <div className="relative">
      <div className="absolute inset-0 rounded-xl bg-gold-400/30 blur-xl animate-[pulse_1.5s_ease-in-out_infinite]" />
      <div className="relative rounded-xl bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500 text-navy-900 font-black text-center py-3 tracking-[0.2em] uppercase text-sm shadow-lg border border-gold-200">
        {text}
      </div>
    </div>
  );
}
