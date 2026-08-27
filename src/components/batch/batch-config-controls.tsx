import type { IconType } from "react-icons";
import {
  LuBadgeDollarSign,
  LuCheck,
  LuFilm,
  LuShuffle,
} from "react-icons/lu";
import styles from "./batch-config-controls.module.css";

export interface BatchChoiceOption {
  value: string;
  label: string;
  icon?: IconType;
}

interface BatchChoiceGroupProps {
  label: string;
  options: readonly BatchChoiceOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  variant?: "cards" | "pills" | "segments";
}

export function BatchChoiceGroup({
  label,
  options,
  value,
  onChange,
  disabled = false,
  variant = "pills",
}: BatchChoiceGroupProps) {
  return (
    <fieldset className={styles.choiceGroup} disabled={disabled}>
      <legend className={styles.groupLabel}>{label}</legend>
      <div className={styles.choiceGrid} data-variant={variant} role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          const Icon = option.icon;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={styles.choice}
              data-selected={selected ? "true" : "false"}
              data-variant={variant}
              onClick={() => onChange(option.value)}
              disabled={disabled}
            >
              {Icon ? <Icon className={styles.choiceIcon} aria-hidden="true" /> : null}
              <span className={styles.choiceLabel}>{option.label}</span>
              <span className={styles.choiceCheck} aria-hidden="true">
                <LuCheck />
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface BatchStrategyPanelProps {
  title: string;
  subtitle: string;
  autoComposeTitle: string;
  autoComposeDescription: string;
  autoCompose: boolean;
  onAutoComposeChange: (checked: boolean) => void;
  productCardTitle: string;
  productCardDescription: string;
  productCard: boolean;
  onProductCardChange: (checked: boolean) => void;
  variationTitle: string;
  variationDescription: string;
  variation: boolean;
  onVariationChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function BatchStrategyPanel({
  title,
  subtitle,
  autoComposeTitle,
  autoComposeDescription,
  autoCompose,
  onAutoComposeChange,
  productCardTitle,
  productCardDescription,
  productCard,
  onProductCardChange,
  variationTitle,
  variationDescription,
  variation,
  onVariationChange,
  disabled = false,
}: BatchStrategyPanelProps) {
  const strategies = [
    {
      key: "compose",
      title: autoComposeTitle,
      description: autoComposeDescription,
      checked: autoCompose,
      onChange: onAutoComposeChange,
      icon: LuFilm,
      disabled: false,
    },
    {
      key: "product-card",
      title: productCardTitle,
      description: productCardDescription,
      checked: productCard,
      onChange: onProductCardChange,
      icon: LuBadgeDollarSign,
      disabled: !autoCompose,
    },
    {
      key: "variation",
      title: variationTitle,
      description: variationDescription,
      checked: variation,
      onChange: onVariationChange,
      icon: LuShuffle,
      disabled: false,
    },
  ] as const;

  return (
    <section className={styles.strategyPanel} aria-labelledby="batch-strategy-title">
      <div className={styles.strategyHeader}>
        <h3 id="batch-strategy-title">{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className={styles.strategyList}>
        {strategies.map((strategy) => {
          const Icon = strategy.icon;
          const rowDisabled = disabled || strategy.disabled;
          return (
            <button
              key={strategy.key}
              type="button"
              role="switch"
              aria-checked={strategy.checked}
              disabled={rowDisabled}
              className={styles.strategyRow}
              data-enabled={strategy.checked ? "true" : "false"}
              onClick={() => strategy.onChange(!strategy.checked)}
            >
              <span className={styles.strategyIcon} aria-hidden="true"><Icon /></span>
              <span className={styles.strategyCopy}>
                <strong>{strategy.title}</strong>
                <small>{strategy.description}</small>
              </span>
              <span className={styles.switch} aria-hidden="true"><span /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
