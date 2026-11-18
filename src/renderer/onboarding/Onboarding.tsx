// First launch (PRD §5.1): local profile → optional avatar → starter world → usable world.
// Shown while the active profile has no active world (ADR-0022). No account, no network and
// no filesystem access are involved: every step is a local IPC command.
import { useEffect, useRef, useState } from 'react';

import type { Session, SessionData } from '../state/session';
import { AvatarChooser } from './AvatarChooser';
import { CreateWorldForm } from './CreateWorldForm';
import { commandProblem } from './form-messages';
import { ProfilePicker } from './ProfilePicker';

const STEPS = ['Profile', 'Avatar', 'World'] as const;

interface OnboardingProps {
  readonly session: Session;
  readonly data: SessionData;
}

export function Onboarding({ session, data }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading, so keyboard and screen-reader users follow along.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const heading = ['Who is using Atlas Realm?', 'Choose an avatar (optional)', 'Create your world'][
    step
  ];

  return (
    <section className="onboarding panel" aria-labelledby="onboarding-heading">
      <p className="step-count">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>
      <h2 id="onboarding-heading" ref={headingRef} tabIndex={-1}>
        {heading}
      </h2>

      {step === 0 && (
        <>
          <p className="muted">
            Profiles live only on this computer. No account or internet connection is needed.
          </p>
          <ProfilePicker
            profiles={data.profiles}
            onRename={session.renameProfile}
            onCreate={session.createProfile}
          />
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setStep(1);
              }}
            >
              Continue as {data.settings.displayName}
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <p className="muted">You can skip this and change it any time in Settings.</p>
          <AvatarChooser
            savedColour={data.settings.avatarColour}
            saveLabel="Save and continue"
            onSave={async (colour) => {
              const outcome = await session.setAvatar(colour);
              if (!outcome.ok) return commandProblem(outcome.error, 'avatar');
              setStep(2);
              return null;
            }}
          >
            <button
              type="button"
              onClick={() => {
                setStep(2);
              }}
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(0);
              }}
            >
              Back
            </button>
          </AvatarChooser>
        </>
      )}

      {step === 2 && (
        <>
          <p className="muted">
            A world is where your projects live. It starts empty; you add projects next.
          </p>
          <CreateWorldForm onCreate={session.createWorld} />
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                setStep(1);
              }}
            >
              Back
            </button>
          </div>
        </>
      )}
    </section>
  );
}
