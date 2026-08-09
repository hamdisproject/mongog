import mongoGIconUrl from '../../assets/mongog-icon.png';

type MongoGBrandProps = {
  size?: 'compact' | 'hero';
  testId?: string;
};

const metrics = {
  compact: { icon: 27, font: 18, gap: 7, letterSpacing: -0.6 },
  hero: { icon: 92, font: 58, gap: 18, letterSpacing: -2.6 },
} as const;

export function MongoGBrand({ size = 'compact', testId }: MongoGBrandProps) {
  const value = metrics[size];

  return (
    <div
      aria-label="MongoG"
      data-testid={testId}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: value.gap,
        minWidth: 0,
        color: 'var(--color-text)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <img
        alt=""
        draggable={false}
        src={mongoGIconUrl}
        style={{
          display: 'block',
          width: value.icon,
          height: value.icon,
          flexShrink: 0,
          objectFit: 'contain',
          filter: size === 'hero'
            ? 'drop-shadow(0 16px 28px rgb(0 0 0 / 38%))'
            : 'drop-shadow(0 3px 7px rgb(0 0 0 / 28%))',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          minWidth: 0,
          fontSize: value.font,
          fontWeight: 720,
          letterSpacing: value.letterSpacing,
        }}
      >
        <span>Mongo</span>
        <span
          style={{
            color: 'var(--color-brand)',
            textShadow: size === 'hero' ? '0 0 28px rgb(75 211 52 / 48%)' : undefined,
          }}
        >
          G
        </span>
      </span>
    </div>
  );
}
