using UnrealBuildTool;

public class ProjectNeonTarget : TargetRules
{
	public ProjectNeonTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("ProjectNeon");
	}
}
