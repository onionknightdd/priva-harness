'use client';

import * as React from 'react';
import { Switch as SwitchPrimitives } from 'radix-ui';
import {
  motion,
  useReducedMotion,
  type TargetAndTransition,
  type VariantLabels,
  type HTMLMotionProps,
  type LegacyAnimationControls,
} from 'motion/react';

import { getStrictContext } from '@/lib/get-strict-context';
import { useControlledState } from '@/hooks/use-controlled-state';

type SwitchContextType = {
  isChecked: boolean;
  isPressed: boolean;
  reducedMotion: boolean;
};

const [SwitchProvider, useSwitch] =
  getStrictContext<SwitchContextType>('SwitchContext');

type SwitchProps = Omit<
  React.ComponentProps<typeof SwitchPrimitives.Root>,
  'asChild'
> &
  HTMLMotionProps<'button'>;

function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  onTapStart,
  onTapCancel,
  onTap,
  ...props
}: SwitchProps) {
  const [isPressed, setIsPressed] = React.useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const [internalChecked, setIsChecked] = useControlledState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  // Server-backed switches stay at the supplied value until the save succeeds.
  const isChecked = checked ?? internalChecked;

  return (
    <SwitchProvider
      value={{
        isChecked,
        isPressed: isPressed && !disabled && !reducedMotion,
        reducedMotion,
      }}
    >
      <SwitchPrimitives.Root
        {...props}
        checked={isChecked}
        onCheckedChange={setIsChecked}
        disabled={disabled}
        asChild
      >
        <motion.button
          {...props}
          data-slot="switch"
          initial={false}
          onTapStart={(event, info) => {
            if (!disabled && !reducedMotion) setIsPressed(true);
            onTapStart?.(event, info);
          }}
          onTapCancel={(event, info) => {
            setIsPressed(false);
            onTapCancel?.(event, info);
          }}
          onTap={(event, info) => {
            setIsPressed(false);
            onTap?.(event, info);
          }}
        />
      </SwitchPrimitives.Root>
    </SwitchProvider>
  );
}

type SwitchThumbProps = Omit<
  React.ComponentProps<typeof SwitchPrimitives.Thumb>,
  'asChild'
> &
  HTMLMotionProps<'div'> & {
    pressedAnimation?:
      | TargetAndTransition
      | VariantLabels
      | boolean
      | LegacyAnimationControls;
  };

function SwitchThumb({
  pressedAnimation,
  transition = { type: 'spring', stiffness: 300, damping: 25 },
  ...props
}: SwitchThumbProps) {
  const { isPressed, reducedMotion } = useSwitch();

  // An empty idle target keeps Motion mounted so the first press animates.
  return (
    <SwitchPrimitives.Thumb asChild>
      <motion.div
        {...props}
        data-slot="switch-thumb"
        initial={false}
        layout={!reducedMotion}
        transition={reducedMotion ? { duration: 0 } : transition}
        animate={isPressed ? pressedAnimation : {}}
      />
    </SwitchPrimitives.Thumb>
  );
}

type SwitchIconPosition = 'left' | 'right' | 'thumb';

type SwitchIconProps = HTMLMotionProps<'div'> & {
  position: SwitchIconPosition;
};

function SwitchIcon({
  position,
  transition = { type: 'spring', bounce: 0 },
  ...props
}: SwitchIconProps) {
  const { isChecked, reducedMotion } = useSwitch();

  const isAnimated = React.useMemo(() => {
    if (position === 'right') return !isChecked;
    if (position === 'left') return isChecked;
    if (position === 'thumb') return true;
    return false;
  }, [position, isChecked]);

  return (
    <motion.div
      {...props}
      data-slot={`switch-${position}-icon`}
      initial={false}
      animate={{
        scale: reducedMotion || isAnimated ? 1 : 0.95,
        opacity: isAnimated ? 1 : 0,
      }}
      transition={reducedMotion ? { duration: 0 } : transition}
    />
  );
}

export {
  Switch,
  SwitchThumb,
  SwitchIcon,
  type SwitchProps,
  type SwitchThumbProps,
  type SwitchIconProps,
  type SwitchIconPosition,
  type SwitchContextType,
};
