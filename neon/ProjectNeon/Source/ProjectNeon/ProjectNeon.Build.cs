using UnrealBuildTool;

public class ProjectNeon : ModuleRules
{
	public ProjectNeon(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicIncludePaths.Add(ModuleDirectory);
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "AIModule",
			"HTTP", "Json", "JsonUtilities", "Slate", "SlateCore", "UMG"
		});
	}
}
