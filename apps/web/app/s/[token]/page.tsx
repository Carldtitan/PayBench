import { ParticipantExperience } from "../../../components/participant/participant-experience";

interface StudyPageProps {
  params: Promise<{ token: string }>;
}

export default async function StudyPage({ params }: StudyPageProps) {
  const { token } = await params;
  return <ParticipantExperience token={token} />;
}
