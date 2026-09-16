"use client";

import { useCallback, useState } from "react";
import LoadingScreen from "@/components/LoadingScreen";
import TeamSelect from "@/components/TeamSelect";
import Camera from "@/components/Camera";
import StripResult from "@/components/StripResult";
import { SHOT_COUNT, type Slot, type Stage, type Team } from "@/lib/types";

const emptyRoll = (): Slot[] => Array.from({ length: SHOT_COUNT }, () => null);

export default function Home() {
  const [stage, setStage] = useState<Stage>("loading");
  const [team, setTeam] = useState<Team>("girl");
  const [photos, setPhotos] = useState<Slot[]>(emptyRoll);

  const startOver = useCallback(() => {
    setPhotos(emptyRoll());
    setStage("select");
  }, []);

  const pickTeam = useCallback((t: Team) => {
    setTeam(t);
    setPhotos(emptyRoll());
    setStage("camera");
  }, []);

  const finishCamera = useCallback(() => setStage("result"), []);
  const leaveLoading = useCallback(() => setStage("select"), []);
  const backToSelect = useCallback(() => setStage("select"), []);

  // Only the result stage needs a complete roll; anything else falls back to
  // the booth rather than handing StripResult a null frame.
  const roll = photos.filter((p): p is string => Boolean(p));
  const rollComplete = roll.length === SHOT_COUNT;

  return (
    <div id="app-root">
      {stage === "loading" && <LoadingScreen onDone={leaveLoading} />}

      {stage === "select" && <TeamSelect onPick={pickTeam} />}

      {stage === "camera" && (
        <Camera
          team={team}
          photos={photos}
          onPhotosChange={setPhotos}
          onDone={finishCamera}
          onBack={backToSelect}
        />
      )}

      {stage === "result" &&
        (rollComplete ? (
          <StripResult team={team} photos={roll} onStartOver={startOver} />
        ) : (
          <Camera
            team={team}
            photos={photos}
            onPhotosChange={setPhotos}
            onDone={finishCamera}
            onBack={backToSelect}
          />
        ))}
    </div>
  );
}
